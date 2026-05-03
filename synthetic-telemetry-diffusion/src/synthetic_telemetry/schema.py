from __future__ import annotations

import json
from pathlib import Path
from typing import List


def load_feature_names(schema_path: Path) -> List[str]:
    data = json.loads(schema_path.read_text(encoding="utf-8"))
    names = data.get("feature_names")
    if not names or not isinstance(names, list):
        raise ValueError("feature_schema.json must contain a non-empty feature_names list")
    return list(names)


def feature_dim(schema_path: Path) -> int:
    return len(load_feature_names(schema_path))
