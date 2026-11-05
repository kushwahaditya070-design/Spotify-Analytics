
const FEATURES = [
    "acousticness",
    "energy",
    "tempo",
    "loudness",
    "danceability",
    "duration_ms",
    "instrumentalness",
    "valence"
];

const DEFAULTS = {
    acousticness: "0.25",
    energy: "0.72",
    tempo: "120",
    loudness: "-7",
    danceability: "0.68",
    duration_ms: "210000",
    instrumentalness: "0.02",
    valence: "0.55"
};

const chartRefs = {};

const $ = selector => document.querySelector(selector);

function titleCase(value) {
    return value.replaceAll("_", " ").replace(/\b\w/g, char =>
        char.toUpperCase()
    );
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function toast(message) {
    const element = $("#toast");
    if (!element) return;

    element.textContent = message;
    element.classList.add("show");

    setTimeout(() => {
        element.classList.remove("show");
    }, 2600);
}

// ==========================================
// DASHBOARD CHARTS
// ==========================================

function makeCharts(data) {

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
            legend: {
                display: false
            }
        },

        scales: {
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    color: "#8c8277",
                    font: {
                        size: 9
                    }
                }
            },

            y: {
                grid: {
                    color: "#ded7cd",
                    borderDash: [3, 5]
                },
                ticks: {
                    color: "#8c8277",
                    font: {
                        size: 9
                    }
                }
            }
        }
    };

    const specifications = [
        ["genreChart", data.genre_distribution || [], "#ff8050"],
        ["popChart", data.popularity_distribution || [], "#a4a995"]
    ];

    specifications.forEach(([id, items, color]) => {

        const canvas = $("#" + id);
        if (!canvas) return;

        if (chartRefs[id]) {
            chartRefs[id].destroy();
        }

        chartRefs[id] = new Chart(canvas, {
            type: "bar",

            data: {
                labels: items.map(item => item.label),

                datasets: [{
                    data: items.map(item => item.value),
                    backgroundColor: color,
                    borderRadius: 4,
                    borderSkipped: false
                }]
            },

            options: commonOptions
        });
    });

    const audioCanvas = $("#audioChart");

    if (audioCanvas) {

        if (chartRefs.audioChart) {
            chartRefs.audioChart.destroy();
        }

        const audio = data.audio_features || [];

        chartRefs.audioChart = new Chart(audioCanvas, {
            type: "bar",

            data: {
                labels: audio.map(item => item.feature),

                datasets: [{
                    data: audio.map(item => item.value),
                    backgroundColor: "#c6a58c",
                    borderRadius: 4
                }]
            },

            options: commonOptions
        });
    }
}

// ==========================================
// DASHBOARD ANALYTICS
// ==========================================

function setAnalytics(data) {

    $("#totalTracks").textContent =
        Number(data.total_tracks || 0).toLocaleString("en-IN");

    $("#avgPopularity").textContent =
        data.average_popularity == null
            ? "—"
            : `${data.average_popularity} / 100`;

    $("#genreCount").textContent =
        data.genres == null
            ? "—"
            : Number(data.genres).toLocaleString("en-IN");

    $("#avgEnergy").textContent =
        data.average_energy == null
            ? "—"
            : `${(
                data.average_energy <= 1
                    ? data.average_energy * 100
                    : data.average_energy
            ).toFixed(1)}%`;

    $("#insightNotes").innerHTML =
        (data.notes || []).map((note, index) => `
            <p>
                <b>${String(index + 1).padStart(2, "0")}</b>
                ${escapeHtml(note)}
            </p>
        `).join("") ||
        '<p class="muted">No insight fields found in this dataset.</p>';

    makeCharts(data);
}

// ==========================================
// DYNAMIC MODEL INPUT FIELDS
// ==========================================

function createModelFields() {

    document.querySelectorAll(".predict-form").forEach(form => {

        const task = form.dataset.task;
        const holder = form.querySelector(".feature-grid");

        const features = FEATURES;

        holder.innerHTML = features.map(feature => `
            <div class="feature-field">

                <label for="${task}-${feature}">
                    ${titleCase(feature)}
                </label>

                <input
                    id="${task}-${feature}"
                    name="${escapeHtml(feature)}"
                    type="number"
                    step="any"
                    required
                    value="${DEFAULTS[feature] ?? ""}"
                    placeholder="Enter ${escapeHtml(feature)}"
                >

            </div>
        `).join("");

    });
}

// ==========================================
// ML STUDIO TAB SWITCHING
// ==========================================

function activateTab(tabName) {

    const tabs = document.querySelectorAll(".model-tab");
    const cards = document.querySelectorAll(".model-card");

    tabs.forEach(tab => {

        const active = tab.dataset.tab === tabName;

        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));

    });

    cards.forEach(card => {

        const active = card.id === tabName;

        card.classList.toggle("active", active);

        // Direct visibility control
        card.style.display = active ? "block" : "none";

    });

}

function initializeTabs() {

    const tabs = document.querySelectorAll(".model-tab");

    tabs.forEach(tab => {

        tab.addEventListener("click", () => {

            activateTab(tab.dataset.tab);

        });

    });

    activateTab("classification");

}

// ==========================================
// FLASK API CONNECTION
// ==========================================

async function refresh() {

    try {

        const [healthResponse, analyticsResponse] =
            await Promise.all([
                fetch("/api/health"),
                fetch("/api/analytics")
            ]);

        if (!healthResponse.ok || !analyticsResponse.ok) {
            throw new Error("API connection failed");
        }

        const health = await healthResponse.json();
        const analytics = await analyticsResponse.json();

        $("#apiStatus").textContent = "CONNECTED";
        $("#apiDetail").textContent = "Dataset endpoint responding";

        if (analytics.available) {

            setAnalytics(analytics);

            $("#uploadStatus").textContent =
                "Spotify dataset loaded";

        } else {

            $("#uploadStatus").textContent =
                "No dataset loaded";

            $("#insightNotes").innerHTML = `
                <p class="muted">
                    ${escapeHtml(analytics.message || "Upload your dataset.")}
                </p>
            `;

        }

        // Build inputs based on backend model metadata
        document.querySelectorAll(".predict-form").forEach(form => {

            const task = form.dataset.task;
            const metadata = health.models?.[task];

            const features =
                metadata?.features?.length
                    ? metadata.features
                    : FEATURES;

            const holder = form.querySelector(".feature-grid");

            holder.innerHTML = features.map(feature => `
                <div class="feature-field">

                    <label for="${task}-${feature}">
                        ${titleCase(feature)}
                    </label>

                    <input
                        id="${task}-${feature}"
                        name="${escapeHtml(feature)}"
                        type="number"
                        step="any"
                        required
                        value="${DEFAULTS[feature] ?? ""}"
                        placeholder="Enter ${escapeHtml(feature)}"
                    >

                </div>
            `).join("");

            const result = form.parentElement.querySelector(".result");

            if (metadata && !metadata.loaded) {

                result.innerHTML = `
                    <p class="error-text">
                        Model load issue:
                        ${escapeHtml(metadata.error || "Unknown error")}
                    </p>
                `;

            }

        });

    } catch (error) {

        $("#apiStatus").textContent = "OFFLINE";
        $("#apiDetail").textContent = "Start the Flask server";

        toast("Could not connect to the Flask API.");

    }

}

// ==========================================
// ML PREDICTION
// ==========================================

document.querySelectorAll(".predict-form").forEach(form => {

    form.addEventListener("submit", async event => {

        event.preventDefault();

        const button = form.querySelector("button");
        const result = form.parentElement.querySelector(".result");
        const task = form.dataset.task;

        const inputs = [...form.querySelectorAll("input")];

        const features = {};

        let valid = true;

        inputs.forEach(input => {

            if (input.value.trim() === "" || !Number.isFinite(Number(input.value))) {
                input.reportValidity();
                valid = false;
            } else {
                features[input.name] = Number(input.value);
            }

        });

        if (!valid) return;

        button.disabled = true;
        button.textContent = "Running model…";

        result.innerHTML = `
            <div class="result-box">
                <small>PROCESSING</small>
                <p>Evaluating your audio features...</p>
            </div>
        `;

        try {

            const response = await fetch(`/api/predict/${task}`, {

                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    features: features
                })

            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.error || "Prediction failed.");
            }

            let label;

            if (task === "regression") {

                label = Number(data.prediction).toFixed(2);

            } else if (task === "clustering") {

                label = `Cluster ${data.prediction}`;

            } else {

                label = String(data.prediction);

            }

            let extra = "";

            if (data.confidence !== undefined) {

                extra += `
                    <p>
                        Top-class confidence:
                        ${(data.confidence * 100).toFixed(1)}%
                    </p>
                `;

            }

            if (data.probabilities) {

                extra += `
                    <div class="prob-list">

                        ${data.probabilities.map(item => `
                            <span>
                                ${escapeHtml(item.class)}
                                · ${(item.probability * 100).toFixed(1)}%
                            </span>
                        `).join("")}

                    </div>
                `;

            }

            if (data.explanation) {

                extra += `
                    <p>${escapeHtml(data.explanation)}</p>
                `;

            }

            result.innerHTML = `
                <div class="result-box">

                    <small>${task.toUpperCase()} RESULT</small>

                    <strong>${escapeHtml(label)}</strong>

                    ${extra}

                </div>
            `;

        } catch (error) {

            result.innerHTML = `
                <p class="error-text">
                    ${escapeHtml(error.message)}
                </p>
            `;

        } finally {

            button.disabled = false;

            button.innerHTML = `
                Run ${task}
                <span>↗</span>
            `;

        }

    });

});

// ==========================================
// DATASET CSV UPLOAD
// ==========================================

$("#datasetFile").addEventListener("change", async event => {

    const file = event.target.files[0];

    if (!file) return;

    $("#uploadStatus").textContent = "Uploading…";

    const formData = new FormData();

    formData.append("file", file);

    try {

        const response = await fetch("/api/dataset", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Upload failed");
        }

        setAnalytics(data.analytics);

        $("#uploadStatus").textContent = file.name;

        toast("Dataset loaded successfully.");

    } catch (error) {

        $("#uploadStatus").textContent = "Upload failed";

        toast(error.message);

    }

});

// ==========================================
// SIDEBAR NAVIGATION
// ==========================================

document.querySelectorAll(".side-link").forEach(link => {

    link.addEventListener("click", () => {

        document.querySelectorAll(".side-link").forEach(item => {
            item.classList.remove("active");
        });

        link.classList.add("active");

        const target = link.getAttribute("href");

        if (
            ["#classification", "#regression", "#clustering"].includes(target)
        ) {

            activateTab(target.substring(1));

        }

    });

});

// ==========================================
// NAVBAR SMOOTH SCROLL
// ==========================================

document.querySelectorAll('a[href^="#"]').forEach(link => {

    link.addEventListener("click", event => {

        const target = document.querySelector(
            link.getAttribute("href")
        );

        if (target) {

            event.preventDefault();

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        }

    });

});

// ==========================================
// REFRESH BUTTON
// ==========================================

$("#refreshBtn").addEventListener("click", refresh);

// ==========================================
// INITIALIZE APPLICATION
// ==========================================

initializeTabs();

createModelFields();

refresh();
