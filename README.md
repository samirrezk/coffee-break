# coffee-break


# Autodesk Platform Services (APS) Data Management and Design Automation App

Data Management + AutoCAD Design Automation web app for browsing DWG files in Forma Data Management (formerly known as ACC Docs), running automation jobs, and uploading successful outputs back as new file versions.

## Overview

This project combines Autodesk Construction Cloud (ACC) browsing and AutoCAD Design Automation in one Express-based web app. It handles Autodesk sign-in, ACC navigation, optional script overrides, AppBundle and Activity setup, job submission, job tracking, and result upload.

## Functionality

- Sign in to Autodesk with 3-legged OAuth
- Browse ACC hubs, projects, folders, and `.dwg` files
- Open the **Ref Canvas** bubble graph to visualize the unfiltered relationship JSON for a selected DWG, or for the full current folder tree when nothing is selected
- Upload an optional `RunMe.scr` override
- Create or update the AutoCAD AppBundle and Activity
- Run automation on selected DWGs or an entire folder tree
- Upload successful outputs back to the same ACC location as a new file version
- Track job history in the UI
- Open persistent `storage/jobs.json` in `notepad.exe` from the UI (Windows only)
- Clear the persisted job log and artifact stage cache from the UI

## Requirements

- [Node.js 20+](https://nodejs.org/en/download)
- Autodesk account
- APS Developer Hub and APS app
- APS app configured as a **Traditional Web App**
- Local callback URL: `http://localhost:8080/api/auth/callback`
- ACC account admin access to add the custom integration

## Runtime Dependencies

Only the packages required by the web app are included:

- `express`
- `express-session`
- `multer`
- `adm-zip`
- `dotenv`

## Create and Connect Your APS App to ACC

### 1. Create your APS developer setup

1. Create or sign in to your Autodesk account.
2. Create an APS Developer Hub.
3. Create a new APS application.
4. Choose **Traditional Web App** as the application type.
5. Copy the **Client ID** and **Client Secret**.

Official guides:

- [APS Getting Started](https://get-started.aps.autodesk.com/)
- [APS Application Setup](https://get-started.aps.autodesk.com/tutorials/acc-admin/setup/)

### 2. Configure the APS app

In your APS app settings:

- Set the callback URL to `http://localhost:8080/api/auth/callback`
- At a minimum, enable the API access to Automation API, Forma API (formerly ACC), and Misc API
- Save your changes

### 3. Add the app to Autodesk Construction Cloud

As an ACC account administrator:

1. Open **Account Admin**.
2. Go to **Custom Integrations**.
3. Click **Add custom integration**.
4. Paste your APS **Client ID**.
5. Enter an integration name and description.
6. Finish the wizard and activate the integration.
7. Confirm the integration has the project or account access your workflow needs.

Official guides:

- [ACC Custom Integrations Help](https://help.autodesk.com/cloudhelp/ENG/Docs-Admin/files/account-administration/Custom_Integrations.html)
- [ACC API Access Tutorial](https://aps.autodesk.com/en/docs/acc/v1/tutorials/getting-started/)

## Configuration

Copy `.env.example` to `.env` for local development.

Required values:

- `SERVER_SESSION_SECRET`
- `APS_CALLBACK_URL`

Optional defaults:

- `APS_CLIENT_ID`
- `APS_CLIENT_SECRET`
- `APS_NICKNAME`
- `APS_BUCKET_KEY`
- `APS_APPBUNDLE_ID`
- `APS_ACTIVITY_ID`
- `APS_AUTOMATION_ALIAS`
- `APS_AUTOCAD_ENGINE`
- `APS_HEALTH_ENGINE` (defaults to `Autodesk.AutoCAD+26_0`; any `Autodesk.Civil3D+xx_x` value is normalized to the matching AutoCAD engine id)

You can also enter APS credentials directly in the UI instead of storing them in `.env`.

## Install, Run, and Test

```bash
npm install
npm test
npm start
```

Open: `http://localhost:8080`

## Smoke Test

```bash
npm test
```

This runs a lightweight syntax + static integration smoke test for the Ref Canvas UI, the frontend graph handlers, and the supporting `/tree-files` backend route.

## Reference Canvas

The UI includes a **Ref Canvas** button beside **Refresh** in the main file browser toolbar.

- If one or more DWGs are selected, the canvas loads the unfiltered relationship JSON for the selected DWG set.
- If nothing is selected, the canvas loads every DWG discovered in the current folder tree and incrementally expands each file relationship graph.
- Bubble size is proportional to file size.
- Bubble color is gray until a drawing-health result is available.
- Selecting a DWG bubble starts a second APS Design Automation run using the DLL extracted from `bundles/isHealthy.bundle.zip`, explicitly `NETLOAD`ed in Core Console with staged DWG references.
- The bottom-right canvas popup shows the `Counts` section from the returned health JSON for the active bubble.
- Healthy bubbles are tinted blue and unhealthy bubbles are tinted red after the health JSON is parsed.
- Green directional arrows represent overlay `nestedType` relationships.
- Solid black arrows represent DWG attachments.
- Dashed arrows represent non-DWG reference targets.
- Clicking a bubble expands that file's relationship graph in-place on the same canvas.
- Mouse wheel zoom, drag-to-pan, and drag-to-reposition bubble interactions are supported.

## Workflow

1. Start the server.
2. Save APS credentials in the UI or provide them in `.env`.
3. Sign in with Autodesk.
4. Browse ACC hubs, projects, and folders.
5. Select one or more DWG files, or target a folder tree.
6. Optionally upload a custom `.scr` override.
7. Create or update the AppBundle and Activity.
8. Submit automation jobs.
9. Use **Ref Canvas** to inspect the unfiltered relationship graph, pan/zoom, and click bubbles to expand additional references in place.
10. Monitor status in the **Automation Jobs** panel.
11. Review logs if needed.
12. Successful outputs are uploaded back to ACC as new file versions.

## Project Structure

```text
.
├── bundles/
│   ├── RunScript.bundle.zip
│   └── isHealthy.bundle.zip
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── storage/
│   ├── artifact-stage-cache.json
│   ├── automation-setups.json
│   ├── jobs.json
│   └── script-override/
├── .env.example
├── package.json
└── server.js
```

## Notes

- Reference Downloading: AutoCAD refget verb only supports for DWG, DXF and DST files, returned ACC relationship graph will be incomplete for Image, Data links, Surface XML and Reference template
- APS credentials entered in the UI are stored in the current server session and are not written to disk.
- Script overrides are stored under `storage/script-override/RunMe.scr`.
- Persistent job history is stored in `storage/jobs.json`.
- **Clear Log** resets both `storage/jobs.json` and `storage/artifact-stage-cache.json`.

# Ref Canvas Update

Now includes a new **Ref Canvas** graph panel for visualizing the unfiltered relationship JSON for DWG files.

## Included changes

- Added **Ref Canvas** button beside **Refresh** in the main Project Files toolbar.
- Added a new **Reference Canvas** panel between the folder context area and the files table.
- Added server endpoint support for current-folder-tree DWG discovery:
  - `GET /api/projects/:projectId/folders/:folderId/tree-files`
- Added interactive SVG bubble graph behavior in `public/app.js`:
  - pan and zoom
  - node drag/reposition
  - click bubble to expand additional references in-place
  - export active bubble JSON
  - open active Autodesk file link
- Added graph styling in `public/styles.css`:
  - gray bubbles sized by file size
  - green arrows for overlay `nestedType`
  - solid black arrows for DWG attachments
  - dashed arrows for non-DWG targets
