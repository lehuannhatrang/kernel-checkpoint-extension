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
    _patch_kernel_handler_for_env_passthrough(server_app)
    server_app.log.info("kernel_checkpoint server extension loaded")


def _patch_kernel_handler_for_env_passthrough(server_app):
    """
    Monkey-patch ``MainKernelHandler.post`` so that an ``env`` dict in the
    request body is forwarded to ``KernelManager.start_kernel``.

    The stock Jupyter Server handler silently drops ``env`` from the POST
    payload.  Enterprise Gateway (and other provisioners) need it to receive
    ``KERNEL_CHECKPOINT_NAME`` during a checkpoint-restore flow.

    Requests that do **not** carry ``env`` are delegated to the original,
    unmodified handler so every other kernel-start path stays untouched.
    """
    from jupyter_server.services.kernels.handlers import MainKernelHandler
    from jupyter_server.utils import url_path_join
    from jupyter_core.utils import ensure_async
    from tornado import web

    original_post = MainKernelHandler.post

    async def _patched_post(self):
        model = self.get_json_body()

        if not model or "env" not in model:
            return await original_post(self)

        km = self.kernel_manager
        model.setdefault("name", km.default_kernel_name)

        env = model["env"]
        self.log.info(
            "kernel_checkpoint: starting kernel with env keys: %s",
            list(env.keys()),
        )

        try:
            kernel_id = await ensure_async(
                km.start_kernel(
                    path=model.get("path"),
                    kernel_name=model["name"],
                    env=env,
                )
            )
            result = await ensure_async(km.kernel_model(kernel_id))
            location = url_path_join(
                self.base_url, "api", "kernels", str(kernel_id)
            )
            self.set_header("Location", location)
            self.set_status(201)
            self.finish(result)
        except Exception as e:
            self.log.error(
                "kernel_checkpoint: env-passthrough kernel start failed: %s", e
            )
            raise web.HTTPError(500, str(e))

    MainKernelHandler.post = _patched_post

    try:
        server_app.config.GatewayClient.client_envs = [
            "KERNEL_CHECKPOINT_NAME",
            "KERNEL_CHECKPOINT_FILE_PATH",
            "KERNEL_CHECKPOINT_CONTAINER_NAME",
            "KERNEL_ID",
        ]
    except Exception:
        pass

    server_app.log.info(
        "kernel_checkpoint: patched MainKernelHandler.post for env passthrough"
    )
