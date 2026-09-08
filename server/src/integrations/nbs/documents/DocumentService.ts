import { nbsClient } from "../NbsClient.js";
import { NbsDocument } from "../NbsTypes.js";

// Only the documented GET methods are implemented. Document/Section/Block
// write endpoints are NOT documented publicly — do not add
// createDocument/createSection/addBlock/linkComponentToSection here until an
// official endpoint is confirmed. See MCP + NBS Nordic (Obsidian) for the
// full rationale.
export interface NbsDocumentProvider {
  listDocuments(projectId?: string | number): Promise<NbsDocument[]>;
  getDocument(documentId: string | number): Promise<NbsDocument>;
  // createDocument?(...): not implemented — no public endpoint.
  // createSection?(...): not implemented — no public endpoint.
  // addBlock?(...): not implemented — no public endpoint.
  // linkComponentToSection?(...): not implemented — no public endpoint.
}

export const documentService: NbsDocumentProvider = {
  async listDocuments(projectId?: string | number) {
    const path = projectId ? `/projects/${projectId}/documents` : `/documents`;
    return nbsClient.request<NbsDocument[]>(path, { useV1: true });
  },

  async getDocument(documentId: string | number) {
    return nbsClient.request<NbsDocument>(`/documents/${documentId}`, { useV1: true });
  },
};
