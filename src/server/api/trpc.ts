/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1)
 * 2. You want to create a new middleware or type of procedure (see Part 3)
 *
 * tl;dr - this is where all the tRPC server stuff is created and plugged in.
 * The pieces you will need to use are documented accordingly near the end
 */

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API
 *
 * These allow you to access things like the database, the session, etc, when
 * processing a request
 *
 */
import { type CreateNextContextOptions } from "@trpc/server/adapters/next";
import { type Session } from "next-auth";
import { type NextApiRequest, type NextApiResponse } from "next";
import { type AxiomAPIRequest } from "next-axiom/dist/withAxiom";
import { type Logger } from "next-axiom";
import { getServerAuthSession } from "../auth";
import { prisma } from "../db";

type CreateContextOptions = {
  req: NextApiRequest;
  res: NextApiResponse;
  session: Session | null;
  log: Logger;
};

/**
 * This helper generates the "internals" for a tRPC context. If you need to use
 * it, you can export it from here
 *
 * Examples of things you may need it for:
 * - testing, so we dont have to mock Next.js' req/res
 * - trpc's `createSSGHelpers` where we don't have req/res
 * @see https://create.t3.gg/en/usage/trpc#-servertrpccontextts
 */
const createInnerTRPCContext = (opts: CreateContextOptions) => {
  return {
    req: opts.req,
    res: opts.res,
    session: opts.session,
    prisma,
    log: opts.log,
  };
};

const isAxiomAPIRequest = (
  req?: NextApiRequest | AxiomAPIRequest
): req is AxiomAPIRequest => {
  return Boolean((req as AxiomAPIRequest)?.log);
};

/**
 * This is the actual context you'll use in your router. It will be used to
 * process every request that goes through your tRPC endpoint
 * @link https://trpc.io/docs/context
 */
export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts;

  if (!isAxiomAPIRequest(req)) {
    throw new Error("req is not the AxiomAPIRequest I expected");
  }

  // Get the session from the server using the unstable_getServerSession wrapper function
  const session = await getServerAuthSession({ req, res });

  //   const log = session ? req.log.with({ userId: session.user.id }) : req.log;
  const log = req.log;

  return createInnerTRPCContext({
    req,
    res,
    session,
    log,
  });
};

/**
 * 2. INITIALIZATION
 *
 * This is where the trpc api is initialized, connecting the context and
 * transformer
 */
import { initTRPC } from "@trpc/server"; // TRPCError
import superjson from "superjson";
import { TRPCError } from "@trpc/server";
import { ethers } from "ethers";
import { ADDRESS } from "../../types/common";

const getVerifiedAddress = (address: string | null | undefined) => {
  if (!address || !ethers.utils.isAddress(address)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid address: ${JSON.stringify(address)}`,
    });
  }
  return address as ADDRESS;
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return shape;
  },
});

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these
 * a lot in the /src/server/api/routers folder
 */

/**
 * This is how you create new routers and subrouters in your tRPC API
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Reusable middleware that enforces users are logged in before running the
 * procedure
 */
// const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
//   if (!ctx.session || !ctx.session.user) {
//     throw new TRPCError({ code: "UNAUTHORIZED" });
//   }
//   return next({
//     ctx: {
//       // infers the `session` as non-nullable
//       session: { ...ctx.session, user: ctx.session.user },
//     },
//   });
// });
const authenticator = t.middleware(async ({ ctx, next }) => {
  const result = await next();

  getVerifiedAddress(ctx.session?.user?.address);

  return result;
});

const logger = t.middleware(async ({ ctx, next }) => {
  const result = await next();
  (ctx.req as AxiomAPIRequest).log = ctx.log;
  return result;
});

export const noProcedure = t.procedure;

/**
 * Public (unauthed) procedure
 *
 * This is the base piece you use to build new queries and mutations on your
 * tRPC API. It does not guarantee that a user querying is authorized, but you
 * can still access user session data if they are logged in
 */
export const publicProcedure = t.procedure.use(logger);

/**
 * Protected (authed) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use
 * this. It verifies the session is valid and guarantees ctx.session.user is not
 * null
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure.use(authenticator).use(logger);
