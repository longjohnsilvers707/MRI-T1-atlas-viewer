"""Allow ``python -m cli ...`` as an alternative to ``python atlas_cli.py``."""
from __future__ import annotations

from . import main

if __name__ == "__main__":
    main()
