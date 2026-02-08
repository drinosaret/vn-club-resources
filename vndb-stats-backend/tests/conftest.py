import os
import sys

# Ensure the backend root is on sys.path so `app.*` imports work when running pytest.
BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)
