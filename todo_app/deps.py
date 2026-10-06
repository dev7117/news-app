"""Process-wide singletons. Import after telemetry.setup() so SQLite is traced."""
from __future__ import annotations

from . import config, db
from .agents import Agents
from .attachments import Attachments
from .cadences import Cadences
from .dispatch import Dispatch
from .hub import Hub
from .ideas import Ideas
from .ledger import Ledger
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
ledger = review.ledger
ledger.backfill()
uploads = Uploads(cfg.db_path.parent)
attachments = Attachments(store, cfg.db_path.parent)
cadences = Cadences(store, hub, attachments)
dispatch = Dispatch(store, agents, people, review, notebook, attachments)
