"""Serve GeoGeo with: python -m uvicorn server:app --reload."""

from pathlib import Path

import requests
from dotenv import load_dotenv
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from co2 import MissingCredentialsError, load_co2

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")


def co2_data(request):
    try:
        stride = int(request.query_params.get("stride", "8"))
        if not 1 <= stride <= 32:
            raise ValueError
    except ValueError:
        return JSONResponse({"error": "stride must be an integer from 1 to 32."}, status_code=400)
    try:
        return JSONResponse(load_co2(stride))
    except MissingCredentialsError:
        return JSONResponse({"error": "Set DISCUSER and DISCPASS in the server's .env file."}, status_code=503)
    except requests.HTTPError as error:
        # PyDAP wraps HTTPError, keeping the original response on its cause.
        while error.response is None and isinstance(error.__cause__, requests.HTTPError):
            error = error.__cause__
        status = error.response.status_code if error.response is not None else None
        message = (
            "Earthdata rejected access. Check DISCUSER/DISCPASS and your Earthdata application authorizations."
            if status in (401, 403) else "NASA could not complete the data request."
        )
        return JSONResponse({"error": message}, status_code=502)
    except Exception:
        # Never return upstream responses or exceptions that could contain auth details.
        return JSONResponse({"error": "Could not fetch or decode the NASA CO2 grid."}, status_code=502)


async def index(request):
    return FileResponse(ROOT / "index.html")


app = Starlette(
    routes=[
        Route("/api/co2", co2_data),
        Route("/", index),
        Route("/index.html", index),
        *[
            Mount(f"/{directory}", StaticFiles(directory=ROOT / directory))
            for directory in ("js", "styles", "data")
        ],
    ]
)
