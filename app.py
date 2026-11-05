from pathlib import Path
import os
import traceback
import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

FEATURES = [
    "acousticness", "energy", "tempo", "loudness",
    "danceability", "duration_ms", "instrumentalness", "valence"
]
MODEL_FILES = {
    "classification": MODEL_DIR / "classification.pkl",
    "regression": MODEL_DIR / "regression.pkl",
    "clustering": MODEL_DIR / "clustering.pkl",
}
ALLOWED_EXTENSIONS = {".csv"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

def walk_objects(obj, seen=None):
    """Walk common sklearn/joblib bundle containers without changing them."""
    if seen is None:
        seen = set()
    if id(obj) in seen:
        return
    seen.add(id(obj))
    yield obj
    if isinstance(obj, dict):
        for value in obj.values():
            yield from walk_objects(value, seen)
    elif isinstance(obj, (list, tuple)):
        for value in obj:
            yield from walk_objects(value, seen)
    elif hasattr(obj, "__dict__") and obj.__class__.__module__.startswith("sklearn"):
        # Only inspect known estimator attributes; avoid traversing large fitted trees.
        for name in ("steps", "named_steps", "estimator", "model", "scaler", "transformer"):
            try:
                value = getattr(obj, name, None)
            except Exception:
                value = None
            if value is not None and value is not obj:
                yield from walk_objects(value, seen)

def load_bundle(path):
    if not path.exists():
        return {"error": f"Missing model file: {path.name}"}
    try:
        # Only load model files supplied by the project owner. Pickle/joblib files can
        # execute code when loaded; do not replace these with files from untrusted sources.
        obj = joblib.load(path)
        objects = list(walk_objects(obj))
        estimators = [x for x in objects if callable(getattr(x, "predict", None))]
        scalers = [x for x in objects if callable(getattr(x, "transform", None))
                   and not callable(getattr(x, "predict", None))]
        # Prefer the most specific estimator type for the task.
        task = path.stem
        preferred = {
            "classification": ("Classifier",),
            "regression": ("Regressor",),
            "clustering": ("KMeans", "Cluster"),
        }.get(task, ())
        estimator = next((x for x in estimators if any(t in x.__class__.__name__ for t in preferred)), None)
        if estimator is None and estimators:
            estimator = estimators[-1]
        if estimator is None:
            raise ValueError("No object with a predict() method was found in this model file.")
        # A Pipeline performs its own preprocessing. Do not apply a second scaler.
        pipeline = estimator.__class__.__name__ == "Pipeline"
        scaler = None if pipeline else (scalers[0] if scalers else None)
        names = getattr(estimator, "feature_names_in_", None)
        if names is None and scaler is not None:
            names = getattr(scaler, "feature_names_in_", None)
        feature_names = [str(x) for x in names] if names is not None else FEATURES
        n = getattr(estimator, "n_features_in_", None)
        if n is None and scaler is not None:
            n = getattr(scaler, "n_features_in_", None)
        if n is not None and int(n) != len(feature_names):
            raise ValueError(f"Model expects {n} features but metadata exposes {len(feature_names)} names.")
        return {"object": obj, "estimator": estimator, "scaler": scaler,
                "features": feature_names, "pipeline": pipeline, "error": None}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}

MODELS = {name: load_bundle(path) for name, path in MODEL_FILES.items()}

def read_dataset():
    candidates = sorted(DATA_DIR.glob("*.csv"))
    if not candidates:
        return None
    try:
        return pd.read_csv(candidates[0], low_memory=False)
    except Exception:
        return None

def clean_number(value, feature):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{feature} must be a valid number.")
    if not np.isfinite(number):
        raise ValueError(f"{feature} must be finite.")
    return number

def prediction_input(task, payload):
    bundle = MODELS[task]
    if bundle.get("error"):
        raise RuntimeError(bundle["error"])
    features = bundle["features"]
    values = payload.get("features", {})
    row = {}
    for feature in features:
        if feature not in values or values[feature] in (None, ""):
            raise ValueError(f"Missing required input: {feature}")
        row[feature] = clean_number(values[feature], feature)
    frame = pd.DataFrame([[row[f] for f in features]], columns=features)
    estimator = bundle["estimator"]
    if bundle["scaler"] is not None:
        frame = bundle["scaler"].transform(frame)
    prediction = estimator.predict(frame)
    result = {"prediction": prediction[0].item() if hasattr(prediction[0], "item") else prediction[0]}
    if task == "classification" and callable(getattr(estimator, "predict_proba", None)):
        probabilities = estimator.predict_proba(
            pd.DataFrame([[row[f] for f in features]], columns=features)
            if bundle["scaler"] is None else bundle["scaler"].transform(
                pd.DataFrame([[row[f] for f in features]], columns=features)
            )
        )[0]
        classes = getattr(estimator, "classes_", range(len(probabilities)))
        result["probabilities"] = [
            {"class": c.item() if hasattr(c, "item") else c, "probability": float(p)}
            for c, p in zip(classes, probabilities)
        ]
        result["confidence"] = float(np.max(probabilities))
    return result

def analytics_payload(df):
    numeric = df.select_dtypes(include="number")
    def mean_of(col):
        return round(float(pd.to_numeric(df[col], errors="coerce").mean()), 2) if col in df else None
    genre_col = next((c for c in ("track_genre", "genre", "playlist_genre") if c in df.columns), None)
    genre_counts = (df[genre_col].fillna("Unknown").astype(str).value_counts().head(12)
                    if genre_col else pd.Series(dtype=int))
    popularity = (pd.cut(pd.to_numeric(df["popularity"], errors="coerce"),
                         bins=[-1, 20, 40, 60, 80, 100],
                         labels=["0–20", "21–40", "41–60", "61–80", "81–100"])
                  .value_counts(sort=False) if "popularity" in df else pd.Series(dtype=int))
    audio_cols = [c for c in ("acousticness", "danceability", "energy", "instrumentalness",
                              "liveness", "speechiness", "valence") if c in df.columns]
    audio = [{"feature": c.replace("_", " ").title(), "value": round(float(pd.to_numeric(df[c], errors="coerce").mean()), 3)}
             for c in audio_cols]
    notes = []
    if not genre_counts.empty:
        notes.append(f"{genre_counts.index[0]} is the most represented genre with {int(genre_counts.iloc[0]):,} tracks.")
    if mean_of("popularity") is not None:
        notes.append(f"Average track popularity is {mean_of('popularity')} out of 100.")
    if mean_of("energy") is not None:
        notes.append(f"Average energy is {round(mean_of('energy') * 100, 1)}%." if mean_of("energy") <= 1 else f"Average energy is {mean_of('energy')}.")
    return {
        "total_tracks": int(len(df)),
        "average_popularity": mean_of("popularity"),
        "genres": int(df[genre_col].nunique(dropna=True)) if genre_col else None,
        "average_energy": mean_of("energy"),
        "genre_distribution": [{"label": str(k), "value": int(v)} for k, v in genre_counts.items()],
        "popularity_distribution": [{"label": str(k), "value": int(v)} for k, v in popularity.items()],
        "audio_features": audio,
        "notes": notes,
        "columns": list(df.columns),
    }

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "models": {k: {"loaded": not bool(v.get("error")), "error": v.get("error"),
                       "features": v.get("features", [])} for k, v in MODELS.items()},
        "dataset_loaded": read_dataset() is not None
    })

@app.get("/api/analytics")
def analytics():
    df = read_dataset()
    if df is None:
        return jsonify({"available": False, "message": "Add your Spotify CSV using the upload control to see real dataset analytics."})
    return jsonify({"available": True, **analytics_payload(df)})

@app.post("/api/dataset")
def upload_dataset():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Choose a CSV file first."}), 400
    if Path(secure_filename(file.filename)).suffix.lower() not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Only CSV files are supported."}), 400
    # Keep one active dataset to make dashboard results unambiguous.
    for old in DATA_DIR.glob("*.csv"):
        old.unlink(missing_ok=True)
    target = DATA_DIR / "spotify_dataset.csv"
    file.save(target)
    try:
        df = pd.read_csv(target, low_memory=False)
        if df.empty:
            raise ValueError("The CSV has no rows.")
    except Exception as exc:
        target.unlink(missing_ok=True)
        return jsonify({"error": f"Could not read CSV: {exc}"}), 400
    return jsonify({"message": "Dataset loaded.", "analytics": analytics_payload(df)})

@app.post("/api/predict/<task>")
def predict(task):
    if task not in MODELS:
        return jsonify({"error": "Unknown prediction task."}), 404
    try:
        result = prediction_input(task, request.get_json(silent=True) or {})
        if task == "clustering":
            result["explanation"] = "This is the cluster label assigned by the trained model. No semantic cluster name is inferred because verified cluster descriptions were not supplied."
        return jsonify({"ok": True, **result})
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("Prediction failed")
        return jsonify({"ok": False, "error": str(exc)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
