import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Nothing to show at the root: send people where they belong before anything renders
export const load: PageServerLoad = ({ locals }) => {
	redirect(302, locals.session ? '/dashboard' : '/login');
};
