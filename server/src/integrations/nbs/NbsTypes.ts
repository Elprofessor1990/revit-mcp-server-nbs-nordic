// Field sets verified live against the NBS Nordic API on 2026-09-08.
// Objects carry many more account/billing fields than listed here — only the
// fields this integration actually relies on are typed; everything else
// passes through via the index signature.

export interface NbsProject {
  id: number;
  project_name: string;
  project_id: string;
  plan: string;
  classification_system_name?: string;
  classificationcode_separator?: string;
  active?: number;
  [key: string]: unknown;
}

export interface NbsComponent {
  id?: number;
  name: string;
  structure?: string;
  classificationcode?: string;
  discipline_id?: number;
  measure_id?: number;
  active?: number | boolean;
  description?: string;
  [key: string]: unknown;
}

export interface NbsInstance {
  id: number;
  component_id?: number;
  quantity?: number;
  instance_parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

// Verified live 2026-09-08: /projects/[id]/components and
// /projects/[id]/instances both wrap their array in an envelope object
// rather than returning a bare array — unlike /projects (list) which IS a
// bare array. Do not assume all list endpoints share one shape.
export interface NbsComponentsListResponse {
  components: NbsComponent[];
  project?: NbsProject;
  meta?: { server_timestamp?: string; [key: string]: unknown };
}

export interface NbsInstancesListResponse {
  instances: NbsInstance[];
  meta?: { server_timestamp?: string; [key: string]: unknown };
}

export interface NbsDocument {
  id: number;
  name?: string;
  [key: string]: unknown;
}
