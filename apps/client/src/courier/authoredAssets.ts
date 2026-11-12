import base from "./assets/avatar/base.json";
import hair3 from "./assets/avatar/hair3.json";
import top2 from "./assets/avatar/top2.json";
import bottom2 from "./assets/avatar/bottom2.json";
import shoes3 from "./assets/avatar/shoes3.json";
import rig from "./assets/avatar/rig.json";
import idlePose from "./assets/avatar/idle-pose.json";
import eyeMask from "./assets/avatar/eye-mask.json";
import palette from "./assets/avatar/palette.json";

export interface AuthoredAttribute {
  itemSize: number;
  array: number[];
  normalized: boolean;
  dataType: number;
}

export interface AuthoredSource {
  url: string;
  sha256: string;
  bytes: number;
}

export interface AuthoredGeometry extends AuthoredSource {
  name: string;
  vertices: number;
  triangles: number;
  attributes: Record<"position" | "normal" | "uv" | "skinIndex" | "skinWeight" | "surfaceId", AuthoredAttribute>;
  indices: number[];
  bounds: { min: number[]; max: number[] };
  metadata: Record<string, unknown>;
  attributeMetadata: {
    name: string;
    index: number;
    uniqueId: number;
    dracoType: number;
    components: number;
    dataType: number;
    metadata: Record<string, unknown>;
  }[];
}

export type AuthoredGeometryName = "base" | "hair3" | "top2" | "bottom2" | "shoes3";

/** Original indexed meshes, in reference units and their common bind pose. */
export const AUTHORED_GEOMETRIES: Record<AuthoredGeometryName, AuthoredGeometry> = {
  base,
  hair3,
  top2,
  bottom2,
  shoes3,
};

export interface AuthoredBoneTransform {
  index: number;
  position: number[];
  quaternion: number[];
  scale: number[];
  worldPosition: number[];
}

export interface AuthoredRigBone extends AuthoredBoneTransform {
  name: string;
  inferredRole: string;
  parent: number;
  matrix: number[];
  matrixWorld: number[];
  inverseBindMatrix: number[];
  worldQuaternion: number[];
}

export interface AuthoredRig extends AuthoredSource {
  format: string;
  info: { type: number; attributes: (string | number)[][] };
  attributes: Record<"position" | "quaternion" | "scale" | "hierarchy", AuthoredAttribute>;
  bones: AuthoredRigBone[];
}

/** Bone order matches skinIndex. Matrices use Three.js column-major order. */
export const AUTHORED_RIG: AuthoredRig = rig;

export interface AuthoredIdlePose {
  animation: string;
  frame: number;
  time: number;
  bones: AuthoredBoneTransform[];
}

/** Local transforms from the first authored idle frame; apply after binding. */
export const AUTHORED_IDLE_POSE: AuthoredIdlePose = idlePose;

/** Original eye mip 0, transcoded to RGBA32 and retaining its red channel. */
export const AUTHORED_EYE_MASK: { width: number; height: number; data: number[] } = eyeMask;

/** Top-down RGBA atlas pixels; use sRGB, nearest filtering, and flipY=true. */
export const AUTHORED_PALETTE: { width: number; height: number; data: number[] } = palette;
