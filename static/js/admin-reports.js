document.addEventListener('click', async (e) => {
  const dismissButton = e.target.closest('.dismiss-report');
  const ignoreButton = e.target.closest('.ignore-reports');
  const deleteButton = e.target.closest('.delete-project');
  if (!dismissButton && !ignoreButton && !deleteButton) {
    return;
  }

  const report = e.target.closest('.admin-report');
  const projectId = report.dataset.projectId;
  const dismissAllForProject = () => {
    for (const el of document.querySelectorAll('.admin-report')) {
      if (el.dataset.projectId === projectId) {
        el.classList.add('dismissed');
      }
    }
  };
  try {
    if (dismissButton) {
      await fetchWithErrorHandling(`api/reports/${dismissButton.dataset.reportId}`, {
        method: 'DELETE'
      });
      report.classList.add('dismissed');
    } else if (ignoreButton) {
      if (!confirm('Dismiss all reports for this project and ignore any future reports?')) {
        return;
      }
      await fetchWithErrorHandling(`api/projects/${projectId}/ignore-reports`, {
        method: 'PUT'
      });
      dismissAllForProject();
    } else {
      if (!confirm('Delete this project? THIS CANNOT BE UNDONE.')) {
        return;
      }
      await fetchWithErrorHandling(`api/projects/${projectId}`, {
        method: 'DELETE'
      });
      // Deleting a project also deletes all of its reports
      dismissAllForProject();
    }
  } catch (err) {
    alert(err);
  }
});
