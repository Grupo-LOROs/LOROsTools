# Lightweight logging setup for worker context
import logging
import json
from datetime import datetime

def setup_logger(path=None):
    logger = logging.getLogger("cfe_extraction")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("[cfe] %(levelname)s %(message)s"))
        logger.addHandler(handler)
    return logger

logger = setup_logger()
