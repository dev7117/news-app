"""Process-wide singletons. Import after telemetry.setup() so SQLite is traced."""
from __future__ import annotations

from . import config, db
from .agents import Agents
from .hub import Hub
from .review import Review
from .store import Store

cfg = config.load()
store = Store(db.connect(cfg.db_path))
hub = Hub(store, cfg.db_path.parent)
review = Review(store, hub)
agents = Agents(store, hub)
