import type { PageServerLoad } from './$types';
import * as db from '$lib/server/db';
import { validateAdminPermissions } from '$lib/server/utils';

export const load: PageServerLoad = ({cookies}) => {
  validateAdminPermissions(cookies.get('adminToken'));

  const reports = db.getAllReports();
  return {
    reports
  };
};
