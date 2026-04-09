try:
    from ._version import __version__
except ImportError:
    import warnings
    warnings.warn("Importing 'kernel_checkpoint' outside a proper installation.")
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "kernel-checkpoint"
    }]


def _jupyter_server_extension_points():
    return [{"module": "kernel_checkpoint"}]


def _load_jupyter_server_extension(server_app):
    from .handlers import setup_handlers
    setup_handlers(server_app.web_app)
    server_app.log.info("kernel_checkpoint server extension loaded")
