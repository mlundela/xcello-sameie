import {betterAuth, generateId} from 'better-auth';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';
import {organization} from 'better-auth/plugins';
import {db} from './db';
import * as schema from '$lib/schema';
import {flat, flatOwnership, ledgerAccount, matchingRule, member, owner} from '$lib/schema';
import {env} from '$env/dynamic/private';
import {sendInviteEmail, sendVerificationEmail} from './email';
import {and, eq} from "drizzle-orm";
import {DEFAULT_ACCOUNTS} from './default-accounts';

if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
if (!env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is not set');
if (!env.ORIGIN) throw new Error('ORIGIN is not set');

export const auth = betterAuth({
    baseURL: env.ORIGIN,
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
    },
    emailVerification: {
        sendVerificationEmail: async ({user, url}: { user: { email: string }; url: string }) => {
            console.log('Send email verification mail:', user.email, url);
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
                    const metadata = org.metadata ?? {};
                    const addressId = metadata.addressId;
                    if (!addressId || !env.MATRIKKEL_API_URL) return;

                    const res = await fetch(`${env.MATRIKKEL_API_URL}/api/adresse/${addressId}`);
                    if (!res.ok) return;

                    const seksjoner: Array<{
                        nummer: number;
                        brøk: { teller: number; nevner: number };
                        bruksenhetNummer: string;
                        eiere: Array<{
                            dato: string;
                            brøk: { teller: number; nevner: number };
                            person: { navn: string; id: string };
                        }>;
                    }> = await res.json();

                    const flatRows = seksjoner.map((s) => ({
                        id: generateId(),
                        organizationId: org.id,
                        nummer: s.nummer,
                        flatNo: s.bruksenhetNummer,
                        shareNumerator: s.brøk.teller,
                        shareDenominator: s.brøk.nevner
                    }));

                    await db.insert(flat).values(flatRows);

                    await db.insert(ledgerAccount).values(
                        DEFAULT_ACCOUNTS.map((a) => ({id: generateId(), organizationId: org.id, ...a}))
                    );

                    for (const seksjon of seksjoner) {
                        const flatId = flatRows.find((f) => f.nummer === seksjon.nummer)!.id;
                        let isFirst = true;

                        for (const eier of seksjon.eiere) {
                            const existing = await db
                                .select({id: owner.id})
                                .from(owner)
                                .where(and(eq(owner.publicId, eier.person.id), eq(owner.organizationId, org.id)))
                                .limit(1);

                            let ownerId: string;
                            if (existing.length === 0) {
                                ownerId = generateId();
                                await db.insert(owner).values({
                                    id: ownerId,
                                    organizationId: org.id,
                                    name: eier.person.navn,
                                    ownerType: 'PERSON',
                                    publicId: eier.person.id
                                });
                            } else {
                                ownerId = existing[0].id;
                            }

                            await db.insert(flatOwnership).values({
                                id: generateId(),
                                flatId,
                                ownerId,
                                fromDate: eier.dato,
                                toDate: null,
                                shareNumerator: eier.brøk.teller,
                                shareDenominator: eier.brøk.nevner,
                                isPaymentResponsible: isFirst
                            });
                            isFirst = false;

                            const existingRule = await db
                                .select({id: matchingRule.id})
                                .from(matchingRule)
                                .where(and(
                                    eq(matchingRule.organizationId, org.id),
                                    eq(matchingRule.ownerId, ownerId)
                                ))
                                .limit(1);

                            if (existingRule.length === 0) {
                                await db.insert(matchingRule).values([
                                        {
                                            id: generateId(),
                                            organizationId: org.id,
                                            pattern: eier.person.navn,
                                            ownerId
                                        }
                                    ]
                                );
                            }
                        }
                    }
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
