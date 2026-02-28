// main.js
document.addEventListener("DOMContentLoaded", () => {
  // hover efek basic sudah dari CSS, ini fokus ke modal ketika di-klik
  const cards = document.querySelectorAll(".feature-card");

  if (!cards.length) return;

  createFeatureModal();

  cards.forEach((card) => {
    // biar kelihatan bisa di-klik
    card.style.cursor = "pointer";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");

    // klik
    card.addEventListener("click", () => openFeatureModal(card));

    // keyboard (Enter / Space)
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFeatureModal(card);
      }
    });
  });
});

let modalOverlay, modalImg, modalTitle, modalText;

function createFeatureModal() {
  // overlay + box
  modalOverlay = document.createElement("div");
  modalOverlay.className = "feature-modal-overlay";
  modalOverlay.innerHTML = `
    <div class="feature-modal">
      <button class="feature-modal-close" aria-label="Close feature detail">
        &times;
      </button>
      <img class="feature-modal-img" alt="" />
      <h3 class="feature-modal-title"></h3>
      <p class="feature-modal-text"></p>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  const modalBox = modalOverlay.querySelector(".feature-modal");
  const closeBtn = modalOverlay.querySelector(".feature-modal-close");
  modalImg = modalOverlay.querySelector(".feature-modal-img");
  modalTitle = modalOverlay.querySelector(".feature-modal-title");
  modalText = modalOverlay.querySelector(".feature-modal-text");

  // klik di luar box atau tombol X → tutup
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay || e.target === closeBtn) {
      closeFeatureModal();
    }
  });

  // Esc → tutup
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeFeatureModal();
    }
  });
}

function openFeatureModal(card) {
  const img = card.querySelector("img");
  const title = card.querySelector("h3");
  const text = card.querySelector("p");

  if (!modalOverlay || !img || !title || !text) return;

  modalImg.src = img.getAttribute("src");
  modalImg.alt = img.getAttribute("alt") || "";
  modalTitle.textContent = title.textContent;
  modalText.textContent = text.textContent;

  // TAMPILKAN modal – TIDAK menyentuh body / scroll
  modalOverlay.classList.add("is-open");
}

function closeFeatureModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.remove("is-open");
}
