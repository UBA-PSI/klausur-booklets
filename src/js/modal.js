const modal = document.getElementById("settingsModal");
const closeBtn = document.querySelector(".close-button");

// Show the modal
function openModal() {
    modal.style.display = "block";
}

// Hide the modal
function closeModal() {
    modal.style.display = "none";
}

// Listen for close button click
closeBtn.addEventListener("click", closeModal);

// Listen for outside click
window.addEventListener("click", outsideClick);

function outsideClick(event) {
    if (event.target == modal) {
        closeModal();
    }
}
