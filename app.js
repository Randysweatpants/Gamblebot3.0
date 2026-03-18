const loadBtn = document.getElementById("loadBtn");
const output = document.getElementById("output");

loadBtn.addEventListener("click", async () => {
  output.textContent = "Loading...";

  try {
    const res = await fetch("https://YOUR-BACKEND-URL.com/api/top-ev-picks?sport=NHL");
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    output.textContent = "Failed to load data.";
  }
});
