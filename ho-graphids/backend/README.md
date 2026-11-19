# GraphIDS / HO-GraphIDS backend

All the Python lives in this repository:

```
backend/
├── graphids/            the model and training code (GraphIDS + multi-hop HO-GraphIDS)
│   ├── main.py          train / test entry point
│   ├── models/graphids.py   SAGELayer (num_hops, hop_mode) + Transformer autoencoder
│   ├── utils/           data loading, training loop, argument parser
│   ├── configs/         tuned hyperparameters per dataset
│   ├── tests/           pytest suite
│   ├── pyproject.toml, uv.lock   the Python environment
│   └── README.md        the GraphIDS documentation
├── score_flows.py       scores an uploaded CSV with a trained model (written for the UI)
└── README.md            this file
```

The web UI runs `backend/graphids/main.py` as a child process. Everything outside
`backend/graphids/` (the Next.js app, `lib/graphids/`) only builds configs, starts Python
and reads its output.

## Setting it up on a new computer (for example one with CUDA)

1. Clone this repository.
2. Create the Python environment. From `backend/graphids`: `uv sync` (the lock file pins
   torch 2.8 and PyG 2.7; the PyG extension wheels must match your torch/CUDA build). The
   environment is created in `backend/graphids/.venv`, which is where the UI looks by default.
   Check it: `.venv\Scripts\python.exe main.py --help` and a short
   `main.py --data_dir ../../data --config configs/NF-UNSW-NB15-v2.yaml --num_epochs 1` must
   get past "Starting training...". On a CPU-only machine PyG needs the CPU build of `pyg-lib`
   (or `torch-sparse`), otherwise the neighbour sampler fails.
3. Put the CSVs in this project's `data/` folder as `data/<name>/<name>.csv`
   (for example `data/NF-UNSW-NB15-v2/NF-UNSW-NB15-v2.csv`). `data/` is git-ignored.
4. Only if something is not in the default place, create `.env.local` in the project root:

   ```
   # Interpreter, if the virtualenv is not backend/graphids/.venv
   GRAPHIDS_PYTHON=D:/envs/graphids/Scripts/python.exe
   # Only to run a different copy of the Python code (default: backend/graphids)
   GRAPHIDS_ROOT=D:/path/to/GraphIDS
   # Only if the CSVs / graph cache live somewhere else (default: ./data)
   GRAPHIDS_DATA_DIR=D:/path/to/data
   ```
5. `npm install`, `npm run dev`.

## How it works

| Piece | What it does |
|---|---|
| `lib/graphids/config.ts` | Paths, the dataset list, uploaded datasets (`data/UPLOAD-*`). |
| `lib/graphids/yaml.ts` | Reads GraphIDS' tuned `configs/<dataset>.yaml`, applies the values you change in the form and writes a per-run `config.yaml`. |
| `lib/graphids/runs.ts` | Starts `main.py` (train, or `--test` with a checkpoint) or `score_flows.py`, keeps one job at a time, parses the log for progress and metrics. |
| `runs/<id>/` | One folder per run: `meta.json`, `log.txt`, `config.yaml`, and for training `model.ckpt` + `scaler.pkl`. Git-ignored. |
| `app/api/*` | `datasets`, `configs/[dataset]`, `runs`, `runs/[id]`, `models`, `uploads`, plus the existing explorer routes. |

Python writes straight into `log.txt`, so a run keeps going if the Next.js server restarts.
Status is rebuilt from the log whenever the page asks.

### What the UI passes to `main.py`

```
python main.py --data_dir <data> --config runs/<id>/config.yaml \
    --checkpoint runs/<id>/model.ckpt --seed <seed>            # train
python main.py ... --checkpoint runs/<model>/model.ckpt --test  # test on the model's own split
```

`--config` wins over the other flags for every experiment setting, so the form values reach
Python through the generated YAML (wandb format, `key: {value: v}`).

### GraphIDS vs HO-GraphIDS

HO-GraphIDS is the same model with a multi-hop SAGELayer graph encoder. It is controlled by
two config keys in `backend/graphids` (`models/graphids.py`, `main.py`, `utils/parser.py`):

| Key | Meaning |
|---|---|
| `num_hops` | Number of SAGELayer hops. `1` (default) is the original GraphIDS, `2` or more is HO-GraphIDS. |
| `hop_mode` | How the extra hops aggregate. `edge` (default): every hop re-aggregates the incoming **edge features** and carries the node embedding forward (E-GraphSAGE). `node`: later hops average the **neighbours' node embeddings** from the previous hop (GraphSAGE). Ignored when `num_hops` is 1. |

`num_layers` is unchanged and still means the Transformer autoencoder depth.

- With `num_hops = 1` the model has the same parameters and gives the same output as before,
  so old checkpoints still load. Configs without the new keys mean `num_hops = 1`.
- The neighbour sampler gets one fanout entry per hop, so a K-hop model sees a K-hop subgraph.
- Multi-hop checkpoints get their own default file name (`..._h2_edge_<seed>.ckpt`), so they
  never overwrite or get loaded into a single-hop model.
- Memory and time grow quickly with the number of hops.

### Testing uploaded files: `score_flows.py`

`main.py` can only evaluate the held-out split of a dataset. `score_flows.py` scores any
NetFlow CSV with a trained model. It imports the GraphIDS model, window dataset and error
function unchanged, repeats the preprocessing of `utils/dataloaders.py`, applies the scaler that
was saved with the model and compares each flow's reconstruction error with the checkpoint's
threshold. It writes `result.json` (counts, top anomalous flows, top hosts, and F1 / PR-AUC
when the file has a `Label` column). It prints `PROGRESS: <phase>|<percent>` lines for the UI.

The upload must contain every feature column the model was trained on, so v2 models need v2
files and v3 models need v3 files.

### Datasets

- Enabled: NF-UNSW-NB15-v2 and v3.
- Disabled for now: NF-CSE-CIC-IDS2018 v2 and v3. `main.py` reads the whole CSV into pandas,
  which does not fit in 7 GB of RAM. To enable them on a bigger machine, set `enabled: true` in
  `lib/graphids/config.ts`. Note that the v3 file is named `NF-CICIDS2018-v3.csv` while the
  Python loader expects `NF-CSE-CIC-IDS2018-v3.csv`.
- Uploads are stored as `data/UPLOAD-<name>-<id>-<v2|v3>/`. Labeled uploads can also be
  trained on. A name containing `v3` selects the v3 feature set in the Python loader, so the
  UI picks the suffix from the file's columns and never lets the file name add one.

### First run on a dataset

`main.py` builds a graph cache in `<data>/pyg_graph_data/<dataset>/` (this is slow and needs a
lot of RAM). Later runs reuse it. The cache must be built with the same seed as the runs that
use it (the UI default is 24, the same as `main.py`).
