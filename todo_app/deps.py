"""Process-wide singletons. Import after telemetry.setup() so SQLite is traced."""
from __future__ import annotations

from . import config, db
from .agents import Agents
from .attachments import Attachments
from .cadences import Cadences
from .hub import Hub
from .ideas import Ideas
from .notebook import Notebook
from .people import People
from .review import Review
from .store import Store
from .uploads import Uploads

cfg = config.load()
store = Store(db.connect(cfg.db_path))
hub = Hub(store, cfg.db_path.parent)
agents = Agents(store, hub)
notebook = Notebook(store)
ideas = Ideas(store, notebook)
people = People(store, hub, notebook)
review = Review(store, hub, ideas, people)
uploads = Uploads(cfg.db_path.parent)
attachments = Attachments(store, cfg.db_path.parent)
cadences = Cadences(store, hub, attachments)
