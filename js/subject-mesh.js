// subject-mesh.js
// Convert a labeled 3D brain volume into per-region triangle meshes packaged
// as a "bundle" object matching the atlas bundle shape. No dependencies.
//
// Public API:
//   SubjectMesh.buildBundleFromLabels(labData, dims, opts) -> bundle
//
// Runs both in the browser (window.SubjectMesh) and Node (module.exports).

var SubjectMesh = (function () {
  'use strict';

  // ---- Marching Cubes tables (Lorensen/Cline; Paul Bourke / three.js) ------

  var edgeTable = new Int32Array([
    0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
    0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
    0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
    0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
    0x230, 0x339, 0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
    0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
    0x3a0, 0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
    0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
    0x460, 0x569, 0x663, 0x76a, 0x66, 0x16f, 0x265, 0x36c,
    0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
    0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0xff, 0x3f5, 0x2fc,
    0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
    0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x55, 0x15c,
    0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
    0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0xcc,
    0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
    0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
    0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
    0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
    0x15c, 0x55, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
    0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
    0x2fc, 0x3f5, 0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
    0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
    0x36c, 0x265, 0x16f, 0x66, 0x76a, 0x663, 0x569, 0x460,
    0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac,
    0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa, 0x1a3, 0x2a9, 0x3a0,
    0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
    0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230,
    0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
    0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99, 0x190,
    0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
    0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x0
  ]);

  // 256 rows, each up to 16 entries terminated by -1.
  var triTable = [
    [-1],
    [0, 8, 3, -1],
    [0, 1, 9, -1],
    [1, 8, 3, 9, 8, 1, -1],
    [1, 2, 10, -1],
    [0, 8, 3, 1, 2, 10, -1],
    [9, 2, 10, 0, 2, 9, -1],
    [2, 8, 3, 2, 10, 8, 10, 9, 8, -1],
    [3, 11, 2, -1],
    [0, 11, 2, 8, 11, 0, -1],
    [1, 9, 0, 2, 3, 11, -1],
    [1, 11, 2, 1, 9, 11, 9, 8, 11, -1],
    [3, 10, 1, 11, 10, 3, -1],
    [0, 10, 1, 0, 8, 10, 8, 11, 10, -1],
    [3, 9, 0, 3, 11, 9, 11, 10, 9, -1],
    [9, 8, 10, 10, 8, 11, -1],
    [4, 7, 8, -1],
    [4, 3, 0, 7, 3, 4, -1],
    [0, 1, 9, 8, 4, 7, -1],
    [4, 1, 9, 4, 7, 1, 7, 3, 1, -1],
    [1, 2, 10, 8, 4, 7, -1],
    [3, 4, 7, 3, 0, 4, 1, 2, 10, -1],
    [9, 2, 10, 9, 0, 2, 8, 4, 7, -1],
    [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4, -1],
    [8, 4, 7, 3, 11, 2, -1],
    [11, 4, 7, 11, 2, 4, 2, 0, 4, -1],
    [9, 0, 1, 8, 4, 7, 2, 3, 11, -1],
    [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1, -1],
    [3, 10, 1, 3, 11, 10, 7, 8, 4, -1],
    [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4, -1],
    [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3, -1],
    [4, 7, 11, 4, 11, 9, 9, 11, 10, -1],
    [9, 5, 4, -1],
    [9, 5, 4, 0, 8, 3, -1],
    [0, 5, 4, 1, 5, 0, -1],
    [8, 5, 4, 8, 3, 5, 3, 1, 5, -1],
    [1, 2, 10, 9, 5, 4, -1],
    [3, 0, 8, 1, 2, 10, 4, 9, 5, -1],
    [5, 2, 10, 5, 4, 2, 4, 0, 2, -1],
    [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8, -1],
    [9, 5, 4, 2, 3, 11, -1],
    [0, 11, 2, 0, 8, 11, 4, 9, 5, -1],
    [0, 5, 4, 0, 1, 5, 2, 3, 11, -1],
    [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5, -1],
    [10, 3, 11, 10, 1, 3, 9, 5, 4, -1],
    [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10, -1],
    [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3, -1],
    [5, 4, 8, 5, 8, 10, 10, 8, 11, -1],
    [9, 7, 8, 5, 7, 9, -1],
    [9, 3, 0, 9, 5, 3, 5, 7, 3, -1],
    [0, 7, 8, 0, 1, 7, 1, 5, 7, -1],
    [1, 5, 3, 3, 5, 7, -1],
    [9, 7, 8, 9, 5, 7, 10, 1, 2, -1],
    [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3, -1],
    [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2, -1],
    [2, 10, 5, 2, 5, 3, 3, 5, 7, -1],
    [7, 9, 5, 7, 8, 9, 3, 11, 2, -1],
    [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11, -1],
    [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7, -1],
    [11, 2, 1, 11, 1, 7, 7, 1, 5, -1],
    [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11, -1],
    [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0, -1],
    [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0, -1],
    [11, 10, 5, 7, 11, 5, -1],
    [10, 6, 5, -1],
    [0, 8, 3, 5, 10, 6, -1],
    [9, 0, 1, 5, 10, 6, -1],
    [1, 8, 3, 1, 9, 8, 5, 10, 6, -1],
    [1, 6, 5, 2, 6, 1, -1],
    [1, 6, 5, 1, 2, 6, 3, 0, 8, -1],
    [9, 6, 5, 9, 0, 6, 0, 2, 6, -1],
    [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8, -1],
    [2, 3, 11, 10, 6, 5, -1],
    [11, 0, 8, 11, 2, 0, 10, 6, 5, -1],
    [0, 1, 9, 2, 3, 11, 5, 10, 6, -1],
    [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11, -1],
    [6, 3, 11, 6, 5, 3, 5, 1, 3, -1],
    [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6, -1],
    [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9, -1],
    [6, 5, 9, 6, 9, 11, 11, 9, 8, -1],
    [5, 10, 6, 4, 7, 8, -1],
    [4, 3, 0, 4, 7, 3, 6, 5, 10, -1],
    [1, 9, 0, 5, 10, 6, 8, 4, 7, -1],
    [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4, -1],
    [6, 1, 2, 6, 5, 1, 4, 7, 8, -1],
    [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7, -1],
    [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6, -1],
    [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9, -1],
    [3, 11, 2, 7, 8, 4, 10, 6, 5, -1],
    [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11, -1],
    [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6, -1],
    [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6, -1],
    [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6, -1],
    [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11, -1],
    [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7, -1],
    [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9, -1],
    [10, 4, 9, 6, 4, 10, -1],
    [4, 10, 6, 4, 9, 10, 0, 8, 3, -1],
    [10, 0, 1, 10, 6, 0, 6, 4, 0, -1],
    [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10, -1],
    [1, 4, 9, 1, 2, 4, 2, 6, 4, -1],
    [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4, -1],
    [0, 2, 4, 4, 2, 6, -1],
    [8, 3, 2, 8, 2, 4, 4, 2, 6, -1],
    [10, 4, 9, 10, 6, 4, 11, 2, 3, -1],
    [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6, -1],
    [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10, -1],
    [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1, -1],
    [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3, -1],
    [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1, -1],
    [3, 11, 6, 3, 6, 0, 0, 6, 4, -1],
    [6, 4, 8, 11, 6, 8, -1],
    [7, 10, 6, 7, 8, 10, 8, 9, 10, -1],
    [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10, -1],
    [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0, -1],
    [10, 6, 7, 10, 7, 1, 1, 7, 3, -1],
    [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7, -1],
    [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9, -1],
    [7, 8, 0, 7, 0, 6, 6, 0, 2, -1],
    [7, 3, 2, 6, 7, 2, -1],
    [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7, -1],
    [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7, -1],
    [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11, -1],
    [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1, -1],
    [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6, -1],
    [0, 9, 1, 11, 6, 7, -1],
    [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0, -1],
    [7, 11, 6, -1],
    [7, 6, 11, -1],
    [3, 0, 8, 11, 7, 6, -1],
    [0, 1, 9, 11, 7, 6, -1],
    [8, 1, 9, 8, 3, 1, 11, 7, 6, -1],
    [10, 1, 2, 6, 11, 7, -1],
    [1, 2, 10, 3, 0, 8, 6, 11, 7, -1],
    [2, 9, 0, 2, 10, 9, 6, 11, 7, -1],
    [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8, -1],
    [7, 2, 3, 6, 2, 7, -1],
    [7, 0, 8, 7, 6, 0, 6, 2, 0, -1],
    [2, 7, 6, 2, 3, 7, 0, 1, 9, -1],
    [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6, -1],
    [10, 7, 6, 10, 1, 7, 1, 3, 7, -1],
    [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8, -1],
    [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7, -1],
    [7, 6, 10, 7, 10, 8, 8, 10, 9, -1],
    [6, 8, 4, 11, 8, 6, -1],
    [3, 6, 11, 3, 0, 6, 0, 4, 6, -1],
    [8, 6, 11, 8, 4, 6, 9, 0, 1, -1],
    [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6, -1],
    [6, 8, 4, 6, 11, 8, 2, 10, 1, -1],
    [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6, -1],
    [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9, -1],
    [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3, -1],
    [8, 2, 3, 8, 4, 2, 4, 6, 2, -1],
    [0, 4, 2, 4, 6, 2, -1],
    [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8, -1],
    [1, 9, 4, 1, 4, 2, 2, 4, 6, -1],
    [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1, -1],
    [10, 1, 0, 10, 0, 6, 6, 0, 4, -1],
    [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3, -1],
    [10, 9, 4, 6, 10, 4, -1],
    [4, 9, 5, 7, 6, 11, -1],
    [0, 8, 3, 4, 9, 5, 11, 7, 6, -1],
    [5, 0, 1, 5, 4, 0, 7, 6, 11, -1],
    [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5, -1],
    [9, 5, 4, 10, 1, 2, 7, 6, 11, -1],
    [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5, -1],
    [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2, -1],
    [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6, -1],
    [7, 2, 3, 7, 6, 2, 5, 4, 9, -1],
    [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7, -1],
    [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0, -1],
    [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8, -1],
    [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7, -1],
    [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4, -1],
    [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10, -1],
    [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10, -1],
    [6, 9, 5, 6, 11, 9, 11, 8, 9, -1],
    [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5, -1],
    [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11, -1],
    [6, 11, 3, 6, 3, 5, 5, 3, 1, -1],
    [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6, -1],
    [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10, -1],
    [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5, -1],
    [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3, -1],
    [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2, -1],
    [9, 5, 6, 9, 6, 0, 0, 6, 2, -1],
    [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8, -1],
    [1, 5, 6, 2, 1, 6, -1],
    [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6, -1],
    [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0, -1],
    [0, 3, 8, 5, 6, 10, -1],
    [10, 5, 6, -1],
    [11, 5, 10, 7, 5, 11, -1],
    [11, 5, 10, 11, 7, 5, 8, 3, 0, -1],
    [5, 11, 7, 5, 10, 11, 1, 9, 0, -1],
    [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1, -1],
    [11, 1, 2, 11, 7, 1, 7, 5, 1, -1],
    [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11, -1],
    [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7, -1],
    [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2, -1],
    [2, 5, 10, 2, 3, 5, 3, 7, 5, -1],
    [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5, -1],
    [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2, -1],
    [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2, -1],
    [1, 3, 5, 3, 7, 5, -1],
    [0, 8, 7, 0, 7, 1, 1, 7, 5, -1],
    [9, 0, 3, 9, 3, 5, 5, 3, 7, -1],
    [9, 8, 7, 5, 9, 7, -1],
    [5, 8, 4, 5, 10, 8, 10, 11, 8, -1],
    [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0, -1],
    [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5, -1],
    [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4, -1],
    [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8, -1],
    [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11, -1],
    [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5, -1],
    [9, 4, 5, 2, 11, 3, -1],
    [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4, -1],
    [5, 10, 2, 5, 2, 4, 4, 2, 0, -1],
    [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9, -1],
    [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2, -1],
    [8, 4, 5, 8, 5, 3, 3, 5, 1, -1],
    [0, 4, 5, 1, 0, 5, -1],
    [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5, -1],
    [9, 4, 5, -1],
    [4, 11, 7, 4, 9, 11, 9, 10, 11, -1],
    [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11, -1],
    [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11, -1],
    [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4, -1],
    [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2, -1],
    [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3, -1],
    [11, 7, 4, 11, 4, 2, 2, 4, 0, -1],
    [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4, -1],
    [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9, -1],
    [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7, -1],
    [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10, -1],
    [1, 10, 2, 8, 7, 4, -1],
    [4, 9, 1, 4, 1, 7, 7, 1, 3, -1],
    [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1, -1],
    [4, 0, 3, 7, 4, 3, -1],
    [4, 8, 7, -1],
    [9, 10, 8, 10, 11, 8, -1],
    [3, 0, 9, 3, 9, 11, 11, 9, 10, -1],
    [0, 1, 10, 0, 10, 8, 8, 10, 11, -1],
    [3, 1, 10, 11, 3, 10, -1],
    [1, 2, 11, 1, 11, 9, 9, 11, 8, -1],
    [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9, -1],
    [0, 2, 11, 8, 0, 11, -1],
    [3, 2, 11, -1],
    [2, 3, 8, 2, 8, 10, 10, 8, 9, -1],
    [9, 10, 2, 0, 9, 2, -1],
    [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8, -1],
    [1, 10, 2, -1],
    [1, 3, 8, 9, 1, 8, -1],
    [0, 9, 1, -1],
    [0, 3, 8, -1],
    [-1]
  ];

  // Corner offsets for a cube, matching the canonical MC vertex numbering.
  var cornerOffset = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
  ];
  // Each edge connects two corner indices (canonical numbering).
  var edgeCorners = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  // ---- base64 of raw typed-array bytes (Node + browser) --------------------

  function base64FromTyped(typed) {
    var bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    var CHUNK = 0x8000;
    var bin = '';
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  // ---- helpers -------------------------------------------------------------

  function round5(v) { return Math.round(v * 1e5) / 1e5; }

  // ---- marching cubes over a label's sub-box, with welding -----------------
  // Returns { positions: [ [x,y,z], ... ] in voxel space, tris: [i0,i1,i2,...] }.

  function marchLabel(labData, dims, id, lo, hi) {
    var W = dims.x, H = dims.y;
    var WH = W * H, D = dims.z;

    // labelAt with out-of-bounds -> 0.
    function inside(x, y, z) {
      if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return 0;
      return labData[x + y * W + z * WH] === id ? 1 : 0;
    }

    var verts = [];        // flat-ish: array of [x,y,z]
    var vertKey = new Map(); // edgeKey -> output vertex index
    var tris = [];

    // Edge key: min(cornerIdxA, cornerIdxB)*3 + axis, where corner index uses a
    // padded grid (W+2 etc. not needed; we use global voxel coords which are
    // unique). Both cubes sharing an edge yield the same two corners -> same key.
    function edgeVertex(cx, cy, cz, e) {
      var a = edgeCorners[e][0], b = edgeCorners[e][1];
      var oa = cornerOffset[a], ob = cornerOffset[b];
      var ax = cx + oa[0], ay = cy + oa[1], az = cz + oa[2];
      var bx = cx + ob[0], by = cy + ob[1], bz = cz + ob[2];
      // canonical order by linear index in an oversized lattice
      var LW = W + 2, LH = H + 2; // pad so indices stay non-negative & unique
      var ia = (ax + 1) + (ay + 1) * LW + (az + 1) * LW * LH;
      var ib = (bx + 1) + (by + 1) * LW + (bz + 1) * LW * LH;
      // axis of edge
      var axis = (ax !== bx) ? 0 : (ay !== by) ? 1 : 2;
      var lo2 = ia < ib ? ia : ib;
      var key = lo2 * 3 + axis;
      var got = vertKey.get(key);
      if (got !== undefined) return got;
      // binary field at iso 0.5 => midpoint (t = 0.5)
      var px = (ax + bx) * 0.5;
      var py = (ay + by) * 0.5;
      var pz = (az + bz) * 0.5;
      var idx = verts.length;
      verts.push([px, py, pz]);
      vertKey.set(key, idx);
      return idx;
    }

    var cval = new Float32Array(8);
    for (var z = lo[2]; z < hi[2]; z++) {
      for (var y = lo[1]; y < hi[1]; y++) {
        for (var x = lo[0]; x < hi[0]; x++) {
          var cubeIndex = 0;
          for (var c = 0; c < 8; c++) {
            var o = cornerOffset[c];
            var v = inside(x + o[0], y + o[1], z + o[2]);
            cval[c] = v;
            if (v > 0.5) cubeIndex |= (1 << c);
          }
          var edges = edgeTable[cubeIndex];
          if (edges === 0) continue;
          // resolve the up-to-12 edge vertices we need
          var vlist = new Array(12);
          for (var e = 0; e < 12; e++) {
            if (edges & (1 << e)) vlist[e] = edgeVertex(x, y, z, e);
          }
          var row = triTable[cubeIndex];
          for (var t = 0; row[t] !== -1; t += 3) {
            tris.push(vlist[row[t]], vlist[row[t + 1]], vlist[row[t + 2]]);
          }
        }
      }
    }
    return { positions: verts, tris: tris };
  }

  // ---- Laplacian smoothing in voxel space ----------------------------------

  function smooth(positions, tris, iterations) {
    if (iterations <= 0 || positions.length === 0) return positions;
    var n = positions.length;
    // build adjacency (sets to avoid dup neighbors)
    var adj = new Array(n);
    for (var i = 0; i < n; i++) adj[i] = new Set();
    for (var t = 0; t < tris.length; t += 3) {
      var a = tris[t], b = tris[t + 1], c = tris[t + 2];
      adj[a].add(b); adj[a].add(c);
      adj[b].add(a); adj[b].add(c);
      adj[c].add(a); adj[c].add(b);
    }
    var adjArr = adj.map(function (s) { return Array.from(s); });
    var cur = positions;
    var factor = 0.5;
    for (var pass = 0; pass < iterations; pass++) {
      var next = new Array(n);
      for (var v = 0; v < n; v++) {
        var nb = adjArr[v];
        if (nb.length === 0) { next[v] = cur[v].slice(); continue; }
        var sx = 0, sy = 0, sz = 0;
        for (var k = 0; k < nb.length; k++) {
          var p = cur[nb[k]];
          sx += p[0]; sy += p[1]; sz += p[2];
        }
        var inv = 1 / nb.length;
        var cx = cur[v][0], cy = cur[v][1], cz = cur[v][2];
        next[v] = [
          cx + factor * (sx * inv - cx),
          cy + factor * (sy * inv - cy),
          cz + factor * (sz * inv - cz)
        ];
      }
      cur = next;
    }
    return cur;
  }

  // ---- main ----------------------------------------------------------------

  function buildBundleFromLabels(labData, dims, opts) {
    opts = opts || {};
    var target = (typeof opts.target === 'number') ? opts.target : 4.0;
    var regionsMeta = opts.regionsMeta || {};
    var smoothIterations = (opts.smoothIterations != null) ? opts.smoothIterations : 2;
    var minVoxels = (opts.minVoxels != null) ? opts.minVoxels : 20;

    var W = dims.x, H = dims.y, D = dims.z;
    var WH = W * H;

    // include filter
    var includeSet = null;
    if (opts.include && opts.include.length) {
      includeSet = new Set(opts.include.map(function (v) { return v | 0; }));
    }

    // First pass: per-label voxel count, bbox, centroid accumulation, and
    // global bbox over included non-background voxels.
    var stats = new Map(); // id -> {count, lo:[3], hi:[3], sum:[3]}
    var gmin = [Infinity, Infinity, Infinity];
    var gmax = [-Infinity, -Infinity, -Infinity];

    for (var z = 0; z < D; z++) {
      for (var y = 0; y < H; y++) {
        var rowBase = y * W + z * WH;
        for (var x = 0; x < W; x++) {
          var id = labData[x + rowBase];
          if (id === 0) continue;
          if (includeSet && !includeSet.has(id)) continue;
          var s = stats.get(id);
          if (!s) {
            s = { count: 0, lo: [x, y, z], hi: [x, y, z], sum: [0, 0, 0] };
            stats.set(id, s);
          }
          s.count++;
          if (x < s.lo[0]) s.lo[0] = x; if (x > s.hi[0]) s.hi[0] = x;
          if (y < s.lo[1]) s.lo[1] = y; if (y > s.hi[1]) s.hi[1] = y;
          if (z < s.lo[2]) s.lo[2] = z; if (z > s.hi[2]) s.hi[2] = z;
          s.sum[0] += x; s.sum[1] += y; s.sum[2] += z;
          if (x < gmin[0]) gmin[0] = x; if (x > gmax[0]) gmax[0] = x;
          if (y < gmin[1]) gmin[1] = y; if (y > gmax[1]) gmax[1] = y;
          if (z < gmin[2]) gmin[2] = z; if (z > gmax[2]) gmax[2] = z;
        }
      }
    }

    // Determine which labels to actually mesh (>= minVoxels).
    var ids = [];
    stats.forEach(function (s, id) {
      if (s.count >= minVoxels) ids.push(id);
    });
    ids.sort(function (a, b) { return a - b; });

    // Global transform.
    var center = [0, 0, 0], factor = 1;
    if (isFinite(gmin[0])) {
      center = [
        (gmin[0] + gmax[0]) / 2,
        (gmin[1] + gmax[1]) / 2,
        (gmin[2] + gmax[2]) / 2
      ];
      var span = Math.max(gmax[0] - gmin[0], gmax[1] - gmin[1], gmax[2] - gmin[2]);
      factor = span > 0 ? target / span : 1;
    }

    function metaFor(id) {
      var m = regionsMeta[id] || regionsMeta[String(id)];
      if (m) {
        return {
          name: m.name != null ? m.name : ('Label' + id),
          displayName: m.displayName != null ? m.displayName : ('Label ' + id),
          hemisphere: m.hemisphere || 'M',
          lobe: m.lobe || 'Other',
          network: m.network || 'Other'
        };
      }
      return {
        name: 'Label' + id, displayName: 'Label ' + id,
        hemisphere: 'M', lobe: 'Other', network: 'Other'
      };
    }

    var regions = [];

    for (var ri = 0; ri < ids.length; ri++) {
      var id = ids[ri];
      var s = stats.get(id);
      // sub-box expanded by 1, clamped. hi is exclusive for the cube loop, so
      // we march cubes whose min corner ranges over [lo-1, hi] (cube spans +1).
      var lo = [
        Math.max(0, s.lo[0] - 1),
        Math.max(0, s.lo[1] - 1),
        Math.max(0, s.lo[2] - 1)
      ];
      // cube origin can go up to hi (inclusive) so its far corner reaches hi+1;
      // clamp exclusive bound to volume size.
      var hi = [
        Math.min(W, s.hi[0] + 2),
        Math.min(H, s.hi[1] + 2),
        Math.min(D, s.hi[2] + 2)
      ];

      var mesh = marchLabel(labData, dims, id, lo, hi);
      if (mesh.positions.length === 0 || mesh.tris.length === 0) continue;

      var smoothed = smooth(mesh.positions, mesh.tris, smoothIterations);

      // apply global transform -> scene space
      var nv = smoothed.length;
      var posF = new Float32Array(nv * 3);
      for (var i = 0; i < nv; i++) {
        var p = smoothed[i];
        posF[i * 3] = (p[0] - center[0]) * factor;
        posF[i * 3 + 1] = (p[1] - center[1]) * factor;
        posF[i * 3 + 2] = (p[2] - center[2]) * factor;
      }
      var idxU = new Uint32Array(mesh.tris.length);
      idxU.set(mesh.tris);

      var meanV = [s.sum[0] / s.count, s.sum[1] / s.count, s.sum[2] / s.count];
      var centroid = [
        round5((meanV[0] - center[0]) * factor),
        round5((meanV[1] - center[1]) * factor),
        round5((meanV[2] - center[2]) * factor)
      ];

      var md = metaFor(id);
      regions.push({
        index: id,
        name: md.name,
        displayName: md.displayName,
        hemisphere: md.hemisphere,
        lobe: md.lobe,
        network: md.network,
        centroid: centroid,
        positions: base64FromTyped(posF),
        indices: base64FromTyped(idxU)
      });
    }

    return {
      meta: {
        count: regions.length,
        scaleFactor: factor,
        center: [center[0], center[1], center[2]],
        target: target,
        units: 'scaled',
        atlas: 'subject',
        source: opts.source || 'subject-segmentation'
      },
      regions: regions
    };
  }

  return { buildBundleFromLabels: buildBundleFromLabels };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SubjectMesh;
if (typeof window !== 'undefined') window.SubjectMesh = SubjectMesh;
