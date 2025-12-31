document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('edit-modal');
  const closeModal = document.querySelector('.close');

  const composerForm = document.getElementById('edit-composer-form');
  const compositionForm = document.getElementById('edit-composition-form');

  // Show modal on edit icon click
  document.querySelectorAll('.edit-icon').forEach(icon => {
    icon.addEventListener('click', () => {
      const type = icon.getAttribute('data-type');
      const id = icon.getAttribute('data-id');
      const name = icon.getAttribute('data-name');
      const lifetime = icon.getAttribute('data-lifetime');  // Get lifetime value
      const title = icon.getAttribute('data-title');        // Get composition title value
      const year = icon.getAttribute('data-year');          // Get composition year value
      const url = icon.getAttribute('data-url');            // Get composition URL value

      // Hide both forms initially
      composerForm.style.display = 'none';
      compositionForm.style.display = 'none';

      if (type === 'composer') {
        // Show composer form and populate data
        composerForm.style.display = 'block';
        document.getElementById('edit-composer-id').value = id;
        document.getElementById('composer-name').value = name;
        document.getElementById('composer-lifetime').value = lifetime; // Set lifetime value
      } else if (type === 'composition') {
        // Show composition form and populate data
        compositionForm.style.display = 'block';
        document.getElementById('edit-composition-id').value = id;
        document.getElementById('composition-title').value = title || '';  // Prepopulate as needed
        document.getElementById('composition-year').value = year || '';    // Prepopulate as needed
        document.getElementById('composition-url').value = url || '';      // Prepopulate as needed
      }

      modal.style.display = 'block';
    });
  });

  // Close modal
  closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  // Save Composer
  document.getElementById('save-composer').addEventListener('click', () => {
    const composerId = document.getElementById('edit-composer-id').value;
    const composerName = document.getElementById('composer-name').value;
    const composerLifetime = document.getElementById('composer-lifetime').value;

    fetch('/edit-composer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: composerId,
        name: composerName,
        lifetime: composerLifetime,
      }),
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert('Composer updated successfully!');
          modal.style.display = 'none';
        } else {
          alert('Error updating composer: ' + data.message);
        }
      })
      .catch(error => console.error('Error:', error));
  });

  // Save Composition
  document.getElementById('save-composition').addEventListener('click', () => {
    const compositionId = document.getElementById('edit-composition-id').value;
    const compositionTitle = document.getElementById('composition-title').value;
    const compositionYear = document.getElementById('composition-year').value;
    const compositionURL = document.getElementById('composition-url').value;

    fetch('/edit-composition', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: compositionId,
        title: compositionTitle,
        year: compositionYear,
        url: compositionURL,
      }),
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert('Composition updated successfully!');
          modal.style.display = 'none';
        } else {
          alert('Error updating composition: ' + data.message);
        }
      })
      .catch(error => console.error('Error:', error));
  });

  // DELETE Composer
  document.getElementById('delete-composer').addEventListener('click', () => {
    const composerId = document.getElementById('edit-composer-id').value;
    const composerName = document.getElementById('composer-name').value;

    const confirmation = prompt(`Are you sure you want to delete the composer: "${composerName}"? Type the name to confirm.`);

    if (confirmation === composerName) {
      fetch('/delete-composer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: composerId,
          name: composerName,
        }),
      })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            alert('Composer deleted successfully!');
            modal.style.display = 'none';
            window.location.reload(); // Reload the page to reflect changes
          } else {
            alert('Error deleting composer: ' + data.message);
          }
        })
        .catch(error => console.error('Error:', error));
    }
  });

  // DELETE Composition
  document.getElementById('delete-composition').addEventListener('click', () => {
    const compositionId = document.getElementById('edit-composition-id').value;

    const confirmation = confirm('Are you sure you want to delete this composition?');

    if (confirmation) {
      fetch('/delete-composition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: compositionId,
        }),
      })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            alert('Composition deleted successfully!');
            modal.style.display = 'none';
            window.location.reload(); // Reload the page to reflect changes
          } else {
            alert('Error deleting composition: ' + data.message);
          }
        })
        .catch(error => console.error('Error:', error));
    }
  });

  // Close modal if clicked outside
  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
});
