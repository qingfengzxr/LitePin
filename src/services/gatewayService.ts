import { KuboClient } from '../clients/kuboClient.js';

export class GatewayService {
  constructor(private readonly kuboClient: KuboClient) {}

  headCid(cid: string) {
    return this.kuboClient.headCid(cid);
  }

  getCid(cid: string) {
    return this.kuboClient.getCid(cid);
  }

  getGatewayReadableStream(response: Response) {
    return this.kuboClient.getGatewayReadableStream(response);
  }

  getGatewayBaseUrl() {
    return this.kuboClient.getGatewayBaseUrl();
  }

  async probeCid(cid: string) {
    const pinned = await this.kuboClient.isPinned(cid);
    const gatewayResponse = await this.kuboClient.headCid(cid);
    return {
      cid,
      pinned,
      readable: gatewayResponse.ok,
      statusCode: gatewayResponse.status,
      contentType: gatewayResponse.headers.get('content-type'),
      contentLength: gatewayResponse.headers.get('content-length'),
      gatewayUrl: this.kuboClient.getGatewayBaseUrl()
    };
  }
}
