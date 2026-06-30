"""
obj_utils.py  —  shared Wavefront OBJ reader for the atlas-viewer scripts.

A single, well-tested OBJ parser used by both build_brain_bundle.py and
render_dexterity_brain_figures.py, so the two no longer reimplement parsing
inconsistently.

Design:
  * ``read_obj(path)`` is the stdlib-only core. It returns
        verts: list[(x, y, z)]   — vertex positions, floats
        tris:  flat list[int]    — triangle indices (0-based), length = 3 * n_tri
    Any polygon face (triangle, quad, or n-gon) is fan-triangulated, i.e. a
    face with vertices v0 v1 v2 ... vk becomes the triangles
    (v0, v1, v2), (v0, v2, v3), ..., (v0, v(k-1), vk). This matches the
    original build_brain_bundle.parse_obj behaviour, which is the correct one.

  * Face tokens of the forms ``a``, ``a/b`` and ``a/b/c`` are accepted; only the
    vertex index (the part before the first ``/``) is used. OBJ indices are
    1-based, so they are converted to 0-based here.

  * ``read_obj_numpy(path)`` is a thin adapter that returns numpy arrays
        V: (n, 3) float
        F: (m, 3) int
    It is the ONLY part of this module that imports numpy, and numpy is imported
    lazily inside the function. That keeps the core reader (and any caller that
    only uses ``read_obj``) free of a numpy dependency — build_brain_bundle stays
    standard-library only.

  * ``read_obj_numpy_cached(path, cache=...)`` adds optional per-path memoisation
    on top of ``read_obj_numpy`` for callers that load the same mesh repeatedly
    (e.g. render_dexterity_brain_figures).
"""


def read_obj(path):
    """Parse a Wavefront OBJ file using only the standard library.

    Returns
    -------
    verts : list[tuple[float, float, float]]
        Vertex positions in file order.
    tris : list[int]
        Flat list of 0-based vertex indices, three per triangle. Polygon faces
        are fan-triangulated.

    Index handling
    --------------
    OBJ vertex references may be positive (1-based, absolute) or negative
    (relative to the vertices seen *so far*: ``-1`` is the most recently
    declared vertex). Both forms are resolved to 0-based indices at the point
    the face line is parsed. Resolved indices are bounds-checked against the
    vertices declared up to that line; an out-of-range reference raises a
    ``ValueError`` naming the file and line number.

    Assumptions
    -----------
    Polygon faces (quads and n-gons) are fan-triangulated from the first
    vertex: ``v0 v1 v2 ... vk`` -> ``(v0,v1,v2), (v0,v2,v3), ...``. This is
    correct only for **convex, roughly planar** polygons; concave faces would
    produce overlapping/inverted triangles. The AAL3 region meshes this module
    serves are triangulated convex surfaces, so the assumption holds.
    """
    verts = []
    tris = []
    with open(path, "r") as f:
        for lineno, line in enumerate(f, 1):
            if line.startswith("v "):
                parts = line.split()
                # A vertex is "v x y z [w]"; take x,y,z and ignore an optional
                # homogeneous w. Anything shorter is malformed.
                if len(parts) < 4:
                    raise ValueError(
                        "%s:%d: malformed vertex line (need 'v x y z'): %r"
                        % (path, lineno, line.rstrip())
                    )
                try:
                    x, y, z = (float(parts[1]), float(parts[2]), float(parts[3]))
                except ValueError:
                    raise ValueError(
                        "%s:%d: non-numeric vertex coordinate: %r"
                        % (path, lineno, line.rstrip())
                    )
                verts.append((x, y, z))
            elif line.startswith("f "):
                # Face tokens may be "a", "a/b", or "a/b/c"; keep the vertex
                # index only. Resolve 1-based positive and negative (relative)
                # OBJ indices to 0-based against the current vertex count.
                idx = []
                nverts = len(verts)
                for tok in line.split()[1:]:
                    try:
                        raw = int(tok.split("/")[0])
                    except ValueError:
                        raise ValueError(
                            "%s:%d: non-integer face index %r"
                            % (path, lineno, tok)
                        )
                    if raw == 0:
                        raise ValueError(
                            "%s:%d: invalid OBJ face index 0 (indices are 1-based)"
                            % (path, lineno)
                        )
                    resolved = nverts + raw if raw < 0 else raw - 1
                    if not (0 <= resolved < nverts):
                        raise ValueError(
                            "%s:%d: face index %d out of range "
                            "(only %d vertices declared so far)"
                            % (path, lineno, raw, nverts)
                        )
                    idx.append(resolved)
                # Triangulate any polygon (triangle/quad/n-gon) as a fan.
                for k in range(1, len(idx) - 1):
                    tris.extend((idx[0], idx[k], idx[k + 1]))
    return verts, tris


def read_obj_numpy(path):
    """Parse an OBJ file and return numpy arrays.

    Thin adapter over :func:`read_obj`. numpy is imported lazily so that callers
    of the core ``read_obj`` never pull in numpy.

    Returns
    -------
    V : numpy.ndarray, shape (n, 3), dtype float
        Vertex positions.
    F : numpy.ndarray, shape (m, 3), dtype int
        Triangle vertex indices (0-based), fan-triangulated from polygon faces.
    """
    import numpy as np

    verts, tris = read_obj(path)
    V = np.asarray(verts, float)
    F = np.asarray(tris, int).reshape(-1, 3)
    return V, F


def read_obj_numpy_cached(path, cache):
    """Like :func:`read_obj_numpy` but memoised per path.

    Parameters
    ----------
    path : str | os.PathLike
        Path to the OBJ file.
    cache : dict
        A caller-owned dict mapping ``str(path) -> (V, F)``. Reused across calls
        to avoid re-parsing the same mesh.
    """
    key = str(path)
    if key in cache:
        return cache[key]
    V, F = read_obj_numpy(path)
    cache[key] = (V, F)
    return V, F
