import os
import json

from tornado import web, httpclient
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join


def _get_api_url():
    return os.environ.get("CHECKPOINT_API_URL", "").rstrip("/")


def _get_namespace():
    ns = os.environ.get("CHECKPOINT_NAMESPACE", "")
    if not ns:
        try:
            with open("/var/run/secrets/kubernetes.io/serviceaccount/namespace") as f:
                ns = f.read().strip()
        except (FileNotFoundError, PermissionError):
            ns = ""
    return ns


class ConfigHandler(APIHandler):
    @web.authenticated
    async def get(self):
        self.finish(json.dumps({
            "checkpointApiUrl": _get_api_url(),
            "namespace": _get_namespace(),
        }))


class CheckpointListCreateHandler(APIHandler):
    """Handles listing and creating checkpoints."""

    @web.authenticated
    async def get(self):
        namespace = self.get_argument("namespace", _get_namespace())
        api_url = _get_api_url()
        if not api_url:
            raise web.HTTPError(500, "CHECKPOINT_API_URL not configured")

        client = httpclient.AsyncHTTPClient()
        url = f"{api_url}/api/v1/checkpoints?namespace={namespace}"
        try:
            resp = await client.fetch(url, raise_error=False)
            self.set_status(resp.code)
            self.set_header("Content-Type", "application/json")
            self.finish(resp.body)
        except Exception as e:
            raise web.HTTPError(502, f"Failed to reach checkpoint API: {e}")

    @web.authenticated
    async def post(self):
        api_url = _get_api_url()
        if not api_url:
            raise web.HTTPError(500, "CHECKPOINT_API_URL not configured")

        body = self.get_json_body()
        client = httpclient.AsyncHTTPClient()
        url = f"{api_url}/api/v1/checkpoints"
        req = httpclient.HTTPRequest(
            url=url,
            method="POST",
            headers={"Content-Type": "application/json"},
            body=json.dumps(body),
        )
        try:
            resp = await client.fetch(req, raise_error=False)
            self.set_status(resp.code)
            self.set_header("Content-Type", "application/json")
            self.finish(resp.body)
        except Exception as e:
            raise web.HTTPError(502, f"Failed to reach checkpoint API: {e}")


class CheckpointDetailHandler(APIHandler):
    """Handles get / delete / patch for a single checkpoint."""

    @web.authenticated
    async def get(self, namespace, name):
        api_url = _get_api_url()
        if not api_url:
            raise web.HTTPError(500, "CHECKPOINT_API_URL not configured")

        client = httpclient.AsyncHTTPClient()
        url = f"{api_url}/api/v1/checkpoints/{namespace}/{name}"
        try:
            resp = await client.fetch(url, raise_error=False)
            self.set_status(resp.code)
            self.set_header("Content-Type", "application/json")
            self.finish(resp.body)
        except Exception as e:
            raise web.HTTPError(502, f"Failed to reach checkpoint API: {e}")

    @web.authenticated
    async def delete(self, namespace, name):
        api_url = _get_api_url()
        if not api_url:
            raise web.HTTPError(500, "CHECKPOINT_API_URL not configured")

        client = httpclient.AsyncHTTPClient()
        url = f"{api_url}/api/v1/checkpoints/{namespace}/{name}"
        req = httpclient.HTTPRequest(url=url, method="DELETE")
        try:
            resp = await client.fetch(req, raise_error=False)
            self.set_status(resp.code)
            if resp.body:
                self.finish(resp.body)
            else:
                self.finish("{}")
        except Exception as e:
            raise web.HTTPError(502, f"Failed to reach checkpoint API: {e}")

    @web.authenticated
    async def patch(self, namespace, name):
        api_url = _get_api_url()
        if not api_url:
            raise web.HTTPError(500, "CHECKPOINT_API_URL not configured")

        body = self.get_json_body()
        client = httpclient.AsyncHTTPClient()
        url = f"{api_url}/api/v1/checkpoints/{namespace}/{name}"
        req = httpclient.HTTPRequest(
            url=url,
            method="PATCH",
            headers={"Content-Type": "application/json"},
            body=json.dumps(body),
        )
        try:
            resp = await client.fetch(req, raise_error=False)
            self.set_status(resp.code)
            self.set_header("Content-Type", "application/json")
            self.finish(resp.body)
        except Exception as e:
            raise web.HTTPError(502, f"Failed to reach checkpoint API: {e}")


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        (
            url_path_join(base_url, "kernel-checkpoint", "config"),
            ConfigHandler,
        ),
        (
            url_path_join(base_url, "kernel-checkpoint", "checkpoints"),
            CheckpointListCreateHandler,
        ),
        (
            url_path_join(
                base_url,
                "kernel-checkpoint",
                "checkpoints",
                r"([^/]+)",
                r"([^/]+)",
            ),
            CheckpointDetailHandler,
        ),
    ]
    web_app.add_handlers(host_pattern, handlers)
