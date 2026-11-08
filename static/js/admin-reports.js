document.addEventListener('click', async (e) => {
  const dismissButton = e.target.closest('.dismiss-report');
  const deleteButton = e.target.closest('.delete-project');
  if (!dismissButton && !deleteButton) {
    return;
  }

  const report = e.target.closest('.admin-report');
  try {
    if (dismissButton) {
      await fetchWithErrorHandling(`/api/reports/${dismissButton.dataset.reportId}`, {
        method: 'DELETE'
      });
      report.classList.add('dismissed');
    } else {
      if (!confirm('Delete this project? THIS CANNOT BE UNDONE.')) {
        return;
      }
      const projectId = report.dataset.projectId;
      await fetchWithErrorHandling(`/api/projects/${projectId}`, {
        method: 'DELETE'
      });
      // Deleting a project also deletes all of its reports
      for (const el of document.querySelectorAll('.admin-report')) {
        if (el.dataset.projectId === projectId) {
          el.classList.add('dismissed');
        }
      }
    }
  } catch (err) {
    alert(err);
  }
});
