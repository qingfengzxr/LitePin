import type { FastifyInstance } from 'fastify';
import { Static } from '@sinclair/typebox';
import { GatewayService } from '../../services/gatewayService.js';
import { CidParamsDtoSchema } from '../dto/common.js';
import { ProbeCidResponseDtoSchema } from '../dto/gatewayDtos.js';

type CidParams = Static<typeof CidParamsDtoSchema>;

type RegisterGatewayRoutesOptions = {
  gatewayService: GatewayService;
  requireAuth: unknown;
};

type AppFastifyInstance = FastifyInstance<any, any, any, any>;

const copyGatewayHeaders = (gatewayResponse: Response, reply: any) => {
  for (const header of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'content-disposition']) {
    const value = gatewayResponse.headers.get(header);
    if (value) {
      reply.header(header, value);
    }
  }
};

export const registerGatewayRoutes = async (app: AppFastifyInstance, options: RegisterGatewayRoutesOptions) => {
  app.head<{ Params: CidParams }>(
    '/ipfs/:cid',
    {
      preHandler: options.requireAuth as any,
      schema: {
        tags: ['gateway'],
        params: CidParamsDtoSchema
      }
    },
    async (request, reply) => {
      const gatewayResponse = await options.gatewayService.headCid(request.params.cid);
      copyGatewayHeaders(gatewayResponse, reply);
      return reply.code(gatewayResponse.status).send();
    }
  );

  app.get<{ Params: CidParams }>(
    '/ipfs/:cid',
    {
      preHandler: options.requireAuth as any,
      schema: {
        tags: ['gateway'],
        params: CidParamsDtoSchema
      }
    },
    async (request, reply) => {
      const gatewayResponse = await options.gatewayService.getCid(request.params.cid);
      copyGatewayHeaders(gatewayResponse, reply);
      reply.code(gatewayResponse.status);
      if (!gatewayResponse.ok || !gatewayResponse.body) {
        return reply.send(await gatewayResponse.text());
      }
      const stream = options.gatewayService.getGatewayReadableStream(gatewayResponse);
      if (!stream) {
        return reply.send();
      }
      return reply.send(stream);
    }
  );

  app.get<{ Params: CidParams }>(
    '/probe/:cid',
    {
      preHandler: options.requireAuth as any,
      schema: {
        tags: ['gateway'],
        params: CidParamsDtoSchema,
        response: {
          200: ProbeCidResponseDtoSchema
        }
      }
    },
    async (request) => options.gatewayService.probeCid(request.params.cid)
  );
};
