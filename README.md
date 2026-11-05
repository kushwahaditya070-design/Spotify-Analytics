<<<<<<< HEAD
# Spotify Analytics — Flask + 3 trained ML models

This project recreates the supplied cream / editorial Spotify Analytics interface and connects the three supplied model files.

## Included models

- `models/classification.pkl` — genre classification model
- `models/regression.pkl` — popularity regression model
- `models/clustering.pkl` — K-Means music clustering model

The three uploaded pickle files contain metadata strings for the same eight audio features, and the project uses this feature order when the model does not expose `feature_names_in_`:

1. `acousticness`
2. `energy`
3. `tempo`
4. `loudness`
5. `danceability`
6. `duration_ms`
7. `instrumentalness`
8. `valence`

The backend prefers each loaded estimator's own `feature_names_in_` metadata when available. It also looks for a separately stored fitted scaler and applies it before prediction. If the model is already a scikit-learn Pipeline, the pipeline handles preprocessing itself.

> **Pickle security:** joblib/pickle files can execute code during loading. Only run the included model files if you trust their origin. Do not replace them with arbitrary downloads.

## Setup (Windows PowerShell)

```powershell
cd spotify-analytics
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**.

If PowerShell blocks activation, run this once in the current terminal:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## Add your Spotify dataset

The supplied Spotify dataset is included at `data/spotify_dataset.csv` (114,000 rows and 21 columns). The dashboard loads it automatically on startup and computes the track count, average popularity, genre count, average energy, genre distribution, popularity distribution, audio-feature averages, and short observations from the actual data. You can replace it later using **Choose CSV** in the Dataset Overview section.

The dashboard recognizes common Spotify columns such as `track_genre` / `genre`, `popularity`, `energy`, `acousticness`, `danceability`, `instrumentalness`, `liveness`, `speechiness`, and `valence`.

Alternatively, put one CSV file in `data/` before starting the app. The upload control replaces the active CSV.

## API endpoints

- `GET /api/health` — API and model load status, discovered feature names
- `GET /api/analytics` — real dataset analytics (or a clear no-dataset response)
- `POST /api/dataset` — upload a CSV (`multipart/form-data`, field `file`)
- `POST /api/predict/classification`
- `POST /api/predict/regression`
- `POST /api/predict/clustering`

Prediction request example:
```json
{
  "features": {
    "acousticness": 0.25,
    "energy": 0.72,
    "tempo": 120,
    "loudness": -7,
    "danceability": 0.68,
    "duration_ms": 210000,
    "instrumentalness": 0.02,
    "valence": 0.55
  }
}
```

The clustering output is intentionally reported as the model's cluster label only. No descriptive music persona is invented without verified cluster profiling data.

## Notes

- Frontend: HTML5, CSS3, vanilla JavaScript, Chart.js.
- Backend: Flask, pandas, NumPy, scikit-learn, joblib.
- Vinyl rotation is a continuous CSS animation.
- Chart.js is loaded from its public CDN, so charts need an internet connection; the rest of the Flask app runs locally.
- The original model files are copied into `models/` without retraining or modifying them.
- The project includes an API/model health endpoint. Since model pickle files are executable serialization formats, loading is done at app startup; run locally in an environment where the supplied files and Python packages are trusted.
=======
# Spotify-Analytics
spotify-analytics-ui
>>>>>>> c52c4c78c2a973b3eda14f5ce78b570b0f62c6e9
