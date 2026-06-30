"""Unit tests for obj_utils.read_obj (C2 hardening).

Covers triangle/quad/n-gon fan triangulation, the a / a/b / a/b/c token forms,
negative (relative) index resolution, and the new error paths: out-of-range
indices and malformed vertex lines must raise a clear ValueError naming the
file and line.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from obj_utils import read_obj  # noqa: E402


def write(tmp_path, text):
    p = tmp_path / "mesh.obj"
    p.write_text(text)
    return str(p)


def test_single_triangle(tmp_path):
    path = write(tmp_path, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")
    verts, tris = read_obj(path)
    assert verts == [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
    assert tris == [0, 1, 2]


def test_quad_is_fan_triangulated(tmp_path):
    path = write(tmp_path,
                 "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n")
    _, tris = read_obj(path)
    # fan from v0: (0,1,2) + (0,2,3)
    assert tris == [0, 1, 2, 0, 2, 3]


def test_ngon_pentagon_fan(tmp_path):
    path = write(tmp_path,
                 "v 0 0 0\nv 1 0 0\nv 2 1 0\nv 1 2 0\nv 0 2 0\nf 1 2 3 4 5\n")
    _, tris = read_obj(path)
    assert tris == [0, 1, 2, 0, 2, 3, 0, 3, 4]


def test_face_token_forms(tmp_path):
    # "a", "a/b", "a/b/c" — only the vertex index (before first /) is used.
    path = write(tmp_path,
                 "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1/10/100 2/20 3\n")
    _, tris = read_obj(path)
    assert tris == [0, 1, 2]


def test_vertex_with_w_component_ignored(tmp_path):
    path = write(tmp_path, "v 0 0 0 1.0\nv 1 0 0 1.0\nv 0 1 0 1.0\nf 1 2 3\n")
    verts, tris = read_obj(path)
    assert verts == [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
    assert tris == [0, 1, 2]


def test_negative_relative_indices(tmp_path):
    # -1 -> most recent vertex, -2 -> second most recent, etc.
    path = write(tmp_path, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n")
    _, tris = read_obj(path)
    assert tris == [0, 1, 2]


def test_negative_indices_are_relative_to_current_count(tmp_path):
    # Two triangles; the second face's -1/-2/-3 must resolve to verts 4,5,6.
    path = write(tmp_path,
                 "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
                 "v 2 0 0\nv 3 0 0\nv 2 1 0\nf -3 -2 -1\n")
    _, tris = read_obj(path)
    assert tris == [0, 1, 2, 3, 4, 5]


def test_out_of_range_positive_index_raises(tmp_path):
    path = write(tmp_path, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n")
    with pytest.raises(ValueError) as exc:
        read_obj(path)
    msg = str(exc.value)
    assert "out of range" in msg
    assert "mesh.obj" in msg
    assert ":4" in msg  # line number of the bad face


def test_out_of_range_negative_index_raises(tmp_path):
    path = write(tmp_path, "v 0 0 0\nv 1 0 0\nf -5 -1 -2\n")
    with pytest.raises(ValueError):
        read_obj(path)


def test_face_index_zero_raises(tmp_path):
    path = write(tmp_path, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n")
    with pytest.raises(ValueError):
        read_obj(path)


def test_malformed_vertex_line_raises(tmp_path):
    path = write(tmp_path, "v 0 0\nf 1 1 1\n")
    with pytest.raises(ValueError) as exc:
        read_obj(path)
    assert "malformed vertex" in str(exc.value)
    assert ":1" in str(exc.value)


def test_non_numeric_vertex_raises(tmp_path):
    path = write(tmp_path, "v 0 zero 0\n")
    with pytest.raises(ValueError) as exc:
        read_obj(path)
    assert "non-numeric" in str(exc.value)
