# Deploy to GitHub Pages

The Pages build includes a snapshot of the pollutant measurements. You don't need
API credentials or a separate server to play the published game.

1. Commit the workflow, build script, JavaScript files, `data/points.json`, and
   `favicon.ico`, then push your changes to `master`.
2. Open your repository's **Settings → Pages** and select **GitHub Actions** under
   **Build and deployment → Source**.
3. Open **Actions → Deploy to GitHub Pages**. If needed, select **Run workflow**
   for `master`. When deployment finishes, open the URL in the deployment job.

Later pushes to `master` deploy automatically. You can open the map explorer at
`explore.html` on the published site.

## Update the published measurements

After importing updated measurements into your local database, run:

```bash
python scripts/build_pages.py --export-data
```

Commit the updated `data/points.json` and push to `master`. The workflow uses that
snapshot, so changes to your local database take effect only after you export it.

## Preview the Pages build

```bash
python scripts/build_pages.py
python -m http.server 8000 --directory _site
```

Open `http://localhost:8000`. If the build reports that `data/points.json` is
missing, export the measurements with the command above.
