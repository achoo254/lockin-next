import { defineBrand } from '@achoo254/brand';
import { primaryOrigin } from '@achoo254/brand/hosts';
import brandConfig from '../../../brand.config.json';

/** The product's name, colours and hosts: read them from here, never hard-code them. */
export const brand = defineBrand(brandConfig);

/** The production host, e.g. for the legal pages. */
export const APP_HOST = new URL(primaryOrigin(brand)).host;

/** The ecosystem's home page (the footer's "An app from …" link). */
export const ECOSYSTEM_URL = `https://${brand.primaryTenant.domain}`;

/** The hoandat.com account page on the IdP, linked from the header's account menu (it opens in a new tab). */
export const IDP_ACCOUNT_URL = `https://auth.${brand.primaryTenant.domain}/account`;

/** Where an account is deleted: only on the IdP, which then tells every app to delete its data (the privacy page). */
export const IDP_ACCOUNT_DELETE_URL = `${IDP_ACCOUNT_URL}#account-delete`;

/** The AI-drawn app icon as the header mark (apps/web/public/brand-mark-96.webp, made by pnpm brand:gen). */
export const BRAND_MARK_SRC = '/brand-mark-96.webp';
