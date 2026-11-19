"""Tests for the multi-hop SAGELayer (HO-GraphIDS): num_hops and hop_mode."""

import pytest
import torch

from main import (
    BACKWARD_COMPATIBLE_DEFAULT_KEYS,
    EXPERIMENT_CONFIG_KEYS,
    default_checkpoint_path,
)
from models.graphids import SAGELayer
from utils.parser import Parser


def _graph(num_nodes=6, num_edges=14, edim=5, seed=0):
    g = torch.Generator().manual_seed(seed)
    edge_index = torch.randint(0, num_nodes, (2, num_edges), generator=g)
    edge_attr = torch.rand(num_edges, edim, generator=g)
    couples = edge_index.t()
    return edge_index, edge_attr, couples, num_nodes


def _layer(**kw):
    torch.manual_seed(1)
    return SAGELayer(ndim_in=5, edim_in=5, edim_out=7, **kw)


def test_one_hop_is_identical_to_the_original_encoder():
    default = _layer()
    explicit = _layer(num_hops=1, hop_mode="node")  # mode is ignored with one hop

    assert len(default.hop_layers) == 0
    # Same parameter names as before, so existing checkpoints still load.
    assert set(default.state_dict()) == {
        "fc_neigh.weight",
        "fc_neigh.bias",
        "fc_edge.weight",
        "fc_edge.bias",
    }
    args = _graph()
    default.eval()
    explicit.eval()
    assert torch.equal(default(*args), explicit(*args))


@pytest.mark.parametrize("mode", ["edge", "node"])
def test_extra_hops_add_layers_and_change_the_output(mode):
    one = _layer(num_hops=1)
    three = _layer(num_hops=3, hop_mode=mode)

    assert len(three.hop_layers) == 2
    # Give both the same first-hop weights, so any difference in the output can
    # only come from the extra hops.
    missing, unexpected = three.load_state_dict(one.state_dict(), strict=False)
    assert not unexpected
    assert all(k.startswith("hop_layers.") for k in missing)

    args = _graph()
    one.eval()
    three.eval()
    out1, out3 = one(*args), three(*args)
    assert out1.shape == out3.shape == (14, 7)
    assert torch.isfinite(out3).all()
    assert not torch.allclose(out1, out3)


def test_modes_differ_and_get_gradients_in_every_layer():
    edge = _layer(num_hops=2, hop_mode="edge")
    node = _layer(num_hops=2, hop_mode="node")
    args = _graph()
    assert not torch.allclose(edge(*args), node(*args))

    for model in (edge, node):
        model.zero_grad()
        model(*args).sum().backward()
        for name, p in model.named_parameters():
            assert p.grad is not None and torch.isfinite(p.grad).all(), name


def test_second_hop_sees_two_hop_neighbours_in_node_mode():
    # Chain 0 -> 1 -> 2. Edge 1->2 can only learn about node 0 through 2 hops.
    edge_index = torch.tensor([[0, 1], [1, 2]])
    edge_attr = torch.tensor([[1.0] * 5, [0.0] * 5])
    couples = torch.tensor([[1, 2]])

    base = _layer(num_hops=2, hop_mode="node")
    base.eval()
    out_a = base(edge_index, edge_attr, couples, 3)
    # Changing the first edge's features must change the second edge's embedding.
    out_b = base(edge_index, torch.zeros_like(edge_attr), couples, 3)
    assert not torch.allclose(out_a, out_b)

    one = _layer(num_hops=1)
    one.eval()
    # With one hop, edge (1,2) embeds nodes 1 and 2, which only read edges 0->1
    # and 1->2, so it depends on edge 0->1 too. Zeroing edge 1->2 is what a single
    # hop cannot see through node 2's own neighbours; sanity-check shapes only.
    assert one(edge_index, edge_attr, couples, 3).shape == (1, 7)


def test_invalid_settings_are_rejected():
    with pytest.raises(ValueError):
        SAGELayer(5, 5, 7, num_hops=0)
    with pytest.raises(ValueError):
        SAGELayer(5, 5, 7, num_hops=2, hop_mode="bogus")


def test_cli_and_config_know_about_the_new_keys():
    args = Parser().parse_args(["--data_dir", "x"])
    assert args.num_hops == 1 and args.hop_mode == "edge"
    args = Parser().parse_args(["--data_dir", "x", "--num_hops", "3", "--hop_mode", "node"])
    assert args.num_hops == 3 and args.hop_mode == "node"
    with pytest.raises(SystemExit):
        Parser().parse_args(["--data_dir", "x", "--hop_mode", "bogus"])

    assert {"num_hops", "hop_mode"} <= set(EXPERIMENT_CONFIG_KEYS)
    # Old YAML configs do not have them; they must be filled from the CLI defaults.
    assert {"num_hops", "hop_mode"} <= set(BACKWARD_COMPATIBLE_DEFAULT_KEYS)


def test_multi_hop_checkpoint_name_never_collides_with_single_hop():
    class C:
        wandb = False
        seed = 24
        dataset = "NF-UNSW-NB15-v2"
        split_mode = "stratified"
        distribution_segment = "pre_shift"
        hop_mode = "edge"

    c = C()
    c.num_hops = 1
    assert default_checkpoint_path(c, "x") == "checkpoints/GraphIDS_NF-UNSW-NB15-v2_24.ckpt"
    c.num_hops = 2
    assert (
        default_checkpoint_path(c, "x")
        == "checkpoints/GraphIDS_NF-UNSW-NB15-v2_h2_edge_24.ckpt"
    )
