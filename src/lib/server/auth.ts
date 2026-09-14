import {betterAuth, generateId} from 'better-auth';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';
import {organization} from 'better-auth/plugins';
import {db} from './db';
import * as schema from '$lib/schema';
import {flat, flatOwnership, ledgerAccount, matchingRule, member, owner} from '$lib/schema';
import {env} from '$env/dynamic/private';
import {sendInviteEmail, sendPasswordResetEmail, sendVerificationEmail} from './email';
import {eq} from "drizzle-orm";
import {DEFAULT_ACCOUNTS} from './default-accounts';
import {building} from '$app/environment';

if (!building) {
    if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
    if (!env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is not set');
    if (!env.ORIGIN) throw new Error('ORIGIN is not set');
    if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');
}

type Seksjon = {
    nummer: number;
    brøk: { teller: number; nevner: number };
    bruksenhetNummer: string;
    eiere: Array<{
        dato: string;
        brøk: { teller: number; nevner: number };
        person: { navn: string; id: string };
    }>;
};

/** kommunenummer/adressekode/nummer/bokstav as built from a Geonorge address. It is pasted into a URL path. */
export const ADDRESS_ID_PATTERN = /^\d{4}\/\d+\/\d+\/[A-Za-z]*$/;

/** Sections and owners at an address from the Matrikkel service. Org creation goes on without them. */
async function fetchSeksjoner(addressId: unknown): Promise<Seksjon[]> {
    if (typeof addressId !== 'string' || !ADDRESS_ID_PATTERN.test(addressId)) return [];
    if (!env.MATRIKKEL_API_URL) {
        console.warn('MATRIKKEL_API_URL is not set; creating organization without flats and owners');
        return [];
    }
    try {
        const res = await fetch(`${env.MATRIKKEL_API_URL}/api/adresse/${addressId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error(`Matrikkel lookup failed for ${addressId}:`, err);
        return [];
    }
}

export const auth = betterAuth({
    baseURL: env.ORIGIN,
    // Rate limiting (on when NODE_ENV=production) keys on this header, which hooks.server.ts sets from
    // the adapter's client address. The default, x-forwarded-for, is missing without a proxy (one
    // bucket for everyone) and chosen by the client with one.
    advanced: { ipAddress: { ipAddressHeaders: ['x-client-address'] } },
    // better-auth rejects a missing secret when NODE_ENV=production, which includes `vite build`
    secret: building ? 'build-time-placeholder-never-used-at-runtime' : env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema: {
            user: schema.user,
            session: schema.session,
            account: schema.account,
            verification: schema.verification,
            organization: schema.organization,
            member: schema.member,
            invitation: schema.invitation
        }
    }),
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        sendResetPassword: async ({user, url}) => {
            // Don't log `url`: it lets anyone set the password
            console.log('Sending password reset email to', user.email);
            await sendPasswordResetEmail({to: user.email, url});
        },
        // A session someone else may have taken over ends when the password changes
        revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
        sendVerificationEmail: async ({user, url}: { user: { email: string }; url: string }) => {
            // Don't log `url`: it signs the user in
            console.log('Sending verification email to', user.email);
            await sendVerificationEmail({to: user.email, url});
        },
        autoSignInAfterVerification: true,
    },
    socialProviders: {
        google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string
        }
    },
    databaseHooks: {
        session: {
            create: {
                before: async (session) => {

                    let memberships = await db
                        .select({org: schema.organization, role: member.role})
                        .from(member)
                        .innerJoin(schema.organization, eq(member.organizationId, schema.organization.id))
                        .where(eq(member.userId, session.userId));

                    let activeOrganizationId = memberships && memberships.map(m => m.org.id)[0]

                    console.log('Set active orgId:', activeOrganizationId);

                    return {
                        data: {
                            ...session,
                            activeOrganizationId,
                        },
                    };
                },
            },
        },
    },
    plugins: [
        organization({
            organizationHooks: {
                afterCreateOrganization: async ({organization: org}) => {
                    // Network call first, so the transaction isn't held open while Matrikkel responds
                    const seksjoner = await fetchSeksjoner(org.metadata?.addressId);

                    await db.transaction(async (tx) => {
                        // Always: every voucher needs these accounts, with or without Matrikkel data
                        await tx.insert(ledgerAccount).values(
                            DEFAULT_ACCOUNTS.map((a) => ({id: generateId(), organizationId: org.id, ...a}))
                        );
                        if (seksjoner.length === 0) return;

                        const flatRows = seksjoner.map((s) => ({
                            id: generateId(),
                            organizationId: org.id,
                            nummer: s.nummer,
                            flatNo: s.bruksenhetNummer,
                            shareNumerator: s.brøk.teller,
                            shareDenominator: s.brøk.nevner
                        }));

                        // One owner (and name-based matching rule) per person, even across several flats
                        const owners = new Map<string, typeof owner.$inferInsert>();
                        const ownerships: (typeof flatOwnership.$inferInsert)[] = [];
                        seksjoner.forEach((seksjon, i) => {
                            seksjon.eiere.forEach((eier, j) => {
                                if (!owners.has(eier.person.id)) {
                                    owners.set(eier.person.id, {
                                        id: generateId(),
                                        organizationId: org.id,
                                        name: eier.person.navn,
                                        ownerType: 'PERSON',
                                        publicId: eier.person.id
                                    });
                                }
                                ownerships.push({
                                    id: generateId(),
                                    flatId: flatRows[i].id,
                                    ownerId: owners.get(eier.person.id)!.id!,
                                    fromDate: eier.dato,
                                    toDate: null,
                                    shareNumerator: eier.brøk.teller,
                                    shareDenominator: eier.brøk.nevner,
                                    isPaymentResponsible: j === 0
                                });
                            });
                        });

                        await tx.insert(flat).values(flatRows);
                        if (owners.size === 0) return;
                        await tx.insert(owner).values([...owners.values()]);
                        await tx.insert(flatOwnership).values(ownerships);
                        await tx.insert(matchingRule).values(
                            [...owners.values()].map((o) => ({
                                id: generateId(),
                                organizationId: org.id,
                                pattern: o.name,
                                ownerId: o.id
                            }))
                        // Two owners with the same name share one rule (patterns are unique per sameie)
                        ).onConflictDoNothing();
                    });
                },
                // After a member is removed
                afterRemoveMember: async ({member, user, organization}) => {
                    console.log(`A member ${user.id} left an organization ${organization.id}`);
                },
            },
            sendInvitationEmail: async (data) => {
                await sendInviteEmail({
                    to: data.email,
                    organizationName: data.organization.name,
                    inviterName: data.inviter.user.name,
                    role: data.role ?? 'member',
                    acceptUrl: `${env.ORIGIN}/invite/${data.id}`
                });
            }
        })
    ]
});

export type Auth = typeof auth;
