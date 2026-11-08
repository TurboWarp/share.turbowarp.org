document.addEventListener('click', async (e) => {
  const button = e.target.closest('.dismiss-report');
  if (!button) {
    return;
  }
  try {
    await fetchWithErrorHandling(`/admin/api/reports/${button.dataset.reportId}`, {
      method: 'DELETE'
    });
    button.closest('.admin-report').classList.add('dismissed');
  } catch (err) {
    alert(err);
  }
});
