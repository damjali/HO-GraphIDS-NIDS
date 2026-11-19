"""Score an uploaded NetFlow CSV with a model trained by GraphIDS / HO-GraphIDS.

GraphIDS' own main.py can only evaluate the held-out split of one of its four
datasets. This script is the missing "inference on new data" path. It does NOT
modify the GraphIDS repository: it imports the repo's own model, window dataset
and error function and repeats the preprocessing of utils/dataloaders.py
(_process) using the scaler that was saved when the model was trained.

Usage (run with the GraphIDS virtualenv's python, cwd anywhere):
    python score_flows.py --root <GraphIDS dir> --checkpoint model.ckpt \
        --config config.yaml --scaler scaler.pkl --csv flows.csv --out result.json

Progress is printed as "PROGRESS: <phase>|<percent>" lines for the web UI.
"""

import argparse
import json
import math
import os
import pickle
import sys
import time
import warnings


def progress(phase, pct):
    print(f"PROGRESS: {phase}|{int(pct)}", flush=True)


def fail(msg):
    print(f"Error: {msg}", flush=True)
    sys.exit(1)


def clean(v):
    """JSON cannot hold NaN/inf; turn them into null."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="GraphIDS project directory")
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--config", required=True, help="the run's config.yaml")
    ap.add_argument("--scaler", required=True, help="scaler.pkl saved with the model")
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--top", type=int, default=50)
    a = ap.parse_args()

    # Import the unmodified GraphIDS code.
    sys.path.insert(0, a.root)
    os.chdir(a.root)
    warnings.filterwarnings(
        "ignore", message="The PyTorch API of nested tensors is in prototype stage"
    )

    import numpy as np
    import pandas as pd
    import torch
    import yaml
    from sklearn.metrics import average_precision_score, f1_score
    from torch.utils.data import DataLoader
    from torch_geometric.data import Data
    from torch_geometric.loader import LinkNeighborLoader

    from models.graphids import GraphIDS
    from utils.dataloaders import SequentialDataset, collate_fn
    from utils.trainers import calculate_errors

    device = "cuda" if torch.cuda.is_available() else "cpu"
    started = time.perf_counter()

    # ---- config (wandb style: key -> {value: v}) and scaler ----
    progress("Loading model", 2)
    with open(a.config) as f:
        raw = yaml.safe_load(f)
    cfg = {k: (v["value"] if isinstance(v, dict) and "value" in v else v) for k, v in raw.items()}
    with open(a.scaler, "rb") as f:
        scaler = pickle.load(f)
    if not hasattr(scaler, "feature_names_in_"):
        fail("the saved scaler has no feature names; retrain the model")
    features = list(scaler.feature_names_in_)
    n_features = len(features)

    # ---- read + preprocess exactly like NetFlowDataset._process ----
    progress("Reading CSV", 5)
    df = pd.read_csv(a.csv)
    need = features + ["IPV4_SRC_ADDR", "IPV4_DST_ADDR"]
    missing = [c for c in need if c not in df.columns]
    if missing:
        fail("CSV is missing columns the model needs: " + ", ".join(missing[:10]))
    n = len(df)
    if n == 0:
        fail("the CSV has no rows")

    labeled = "Label" in df.columns
    y = df["Label"].astype(int).to_numpy() if labeled else np.zeros(n, dtype=int)

    progress("Scaling features", 15)
    x = df[features].replace([np.inf, -np.inf], np.nan).fillna(0)
    x = np.clip(scaler.transform(x), -10, 10)  # same as the val/test path in training

    progress("Building graph", 25)
    codes, uniques = pd.factorize(pd.concat([df["IPV4_SRC_ADDR"], df["IPV4_DST_ADDR"]]))
    src, dst = codes[:n], codes[n:]
    num_nodes = len(uniques)
    graph = Data(
        x=torch.ones(num_nodes, n_features, dtype=torch.float),
        edge_index=torch.tensor(np.array([src, dst]), dtype=torch.long),
        edge_attr=torch.tensor(x, dtype=torch.float),
        edge_labels=torch.tensor(y, dtype=torch.long),
        num_nodes=num_nodes,
    )

    # ---- model: same constructor call as main.py ----
    model = GraphIDS(
        ndim_in=n_features,
        edim_in=n_features,
        edim_out=cfg["edim_out"],
        embed_dim=cfg["ae_embedding_dim"],
        num_heads=4,
        num_layers=cfg["num_layers"],
        window_size=cfg["window_size"],
        dropout=cfg["dropout"],
        ae_dropout=cfg["ae_dropout"],
        positional_encoding=cfg["positional_encoding"],
        agg_type=cfg["agg_type"],
        mask_ratio=cfg["mask_ratio"],
        ae_feedforward_dim=cfg.get("ae_feedforward_dim", 256),
        # Older configs have no multi-hop keys: that is the single-hop GraphIDS.
        num_hops=cfg.get("num_hops", 1),
        hop_mode=cfg.get("hop_mode", "edge"),
    ).to(device)
    _, threshold = model.load_checkpoint(a.checkpoint)
    if threshold is None:
        fail("the checkpoint has no threshold; train it to completion first")
    model.eval()

    # ---- score: mirrors utils.trainers._collect_errors_and_labels, but keeps
    # the original row of every flow (the loader may shuffle) ----
    shuffle = cfg["positional_encoding"] == "None"
    # One sampling entry per hop, exactly as main.py does.
    fanout = [cfg["fanout"]] * cfg.get("num_hops", 1)
    loader = LinkNeighborLoader(
        data=graph,
        num_neighbors=fanout,
        edge_label_index=graph.edge_index,
        edge_label=graph.edge_labels,
        batch_size=cfg["batch_size"],
        shuffle=shuffle,
        num_workers=0,
        drop_last=False,
    )
    errors = torch.zeros(n)
    scored = torch.zeros(n, dtype=torch.bool)
    total_batches = max(1, math.ceil(n / cfg["batch_size"]))
    window = cfg["window_size"]
    with torch.inference_mode():
        for bi, batch in enumerate(loader):
            if not hasattr(batch, "input_id") or batch.input_id is None:
                fail("this PyG version does not expose input_id on link batches")
            ids = batch.input_id.cpu()
            batch.batch_edge_couples = batch.edge_label_index.t()
            batch = batch.to(device)
            emb = model.encoder(
                batch.edge_index, batch.edge_attr, batch.batch_edge_couples, batch.num_nodes
            )
            ae_loader = DataLoader(
                SequentialDataset(emb, window=window, step=window, device=device),
                batch_size=cfg["ae_batch_size"],
                collate_fn=collate_fn,
            )
            parts = []
            for ae_batch, mask in ae_loader:
                out = model.transformer(ae_batch, mask)
                parts.append(calculate_errors(out, ae_batch, mask).cpu())
            if parts:
                e = torch.cat(parts)
                if len(e) == len(ids):
                    errors[ids] = e
                    scored[ids] = True
            progress("Scoring flows", 30 + 65 * (bi + 1) / total_batches)

    progress("Summarising", 96)
    idx = scored.nonzero().squeeze(1).numpy()
    if len(idx) == 0:
        fail("no flows could be scored")
    err = errors[idx].numpy()
    pred = (err > threshold).astype(int)

    result = {
        "flows": int(n),
        "scoredFlows": int(len(idx)),
        "threshold": clean(float(threshold)),
        "predictedBenign": int((pred == 0).sum()),
        "predictedMalicious": int((pred == 1).sum()),
        "labeled": bool(labeled),
        "errorStats": {
            "min": clean(float(err.min())),
            "median": clean(float(np.median(err))),
            "mean": clean(float(err.mean())),
            "p99": clean(float(np.percentile(err, 99))),
            "max": clean(float(err.max())),
        },
        "seconds": round(time.perf_counter() - started, 2),
    }

    if labeled:
        yt = y[idx]
        m = {
            "tp": int(((pred == 1) & (yt == 1)).sum()),
            "fp": int(((pred == 1) & (yt == 0)).sum()),
            "tn": int(((pred == 0) & (yt == 0)).sum()),
            "fn": int(((pred == 0) & (yt == 1)).sum()),
            "f1": clean(float(f1_score(yt, pred, average="macro", zero_division=0))),
        }
        # PR-AUC is only defined when both classes are present.
        m["prAuc"] = (
            clean(float(average_precision_score(yt, err))) if len(set(yt.tolist())) > 1 else None
        )
        result["metrics"] = m

    # Most anomalous flows and the hosts involved in the most flagged flows.
    cols = [
        c
        for c in [
            "IPV4_SRC_ADDR",
            "L4_SRC_PORT",
            "IPV4_DST_ADDR",
            "L4_DST_PORT",
            "PROTOCOL",
            "IN_BYTES",
            "OUT_BYTES",
            "Attack",
        ]
        if c in df.columns
    ]
    order = np.argsort(-err)[: a.top]
    top = []
    for k in order:
        row = int(idx[k])
        rec = {"row": row + 2, "error": clean(float(err[k])), "flagged": bool(pred[k])}
        for c in cols:
            v = df.iloc[row][c]
            rec[c] = v.item() if hasattr(v, "item") else v
        if labeled:
            rec["label"] = int(y[row])
        top.append(rec)
    result["top"] = top

    flagged = df.iloc[idx[pred == 1]]
    hosts = pd.concat([flagged["IPV4_SRC_ADDR"], flagged["IPV4_DST_ADDR"]]).value_counts().head(10)
    result["topHosts"] = [{"ip": str(ip), "flaggedFlows": int(c)} for ip, c in hosts.items()]

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(result, f, allow_nan=False)
    progress("Done", 100)


if __name__ == "__main__":
    main()
