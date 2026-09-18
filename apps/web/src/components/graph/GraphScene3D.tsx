import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree, invalidate } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, Html, Line } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type {
  GraphProjection,
  GraphProjectionNode,
} from "@/api";
import { GraphNodeGlyph } from "@/components/graph/GraphNodeGlyph";
import {
  defaultCollapsedSet,
  hiddenDescendantIds,
  recollapsePlatformRayBeyond,
} from "@/lib/graph-collapse";
import { buildGraphNodeColors, graphNodeColor } from "@/lib/graph-node-style";
import { useTheme } from "next-themes";

const DEFAULT_EYE = new THREE.Vector3(5.2, 5.8, 16);
const DEFAULT_TARGET = new THREE.Vector3(1.8, 4.6, 0);
const SCENE_BG_DARK = "#0a0a0b";
const SCENE_BG_LIGHT = "#f4f4f5";

/** Exclusive owner surface wings: only one owner's surfaces open at a time. */
const OWNER_SURFACE_WINGS: readonly (readonly string[])[] = [
  [
    "hub:structure-you",
    "hub:knowledge-you",
    "hub:automations-you",
    "hub:calendar-you",
  ],
  [
    "hub:structure-intelligence",
    "hub:knowledge-intelligence",
    "hub:automations-intelligence",
    "hub:calendar-intelligence",
  ],
  [
    "hub:structure-research",
    "hub:knowledge-research",
    "hub:automations-research",
    "hub:calendar-research",
  ],
  [
    "hub:structure-ops",
    "hub:knowledge-ops",
    "hub:automations-ops",
    "hub:calendar-ops",
  ],
];

/** Exclusive Vault trees: only one owner Vault open at a time. */
const VAULT_TREE_IDS = [
  "hub:vault-you",
  "hub:vault-intelligence",
  "hub:vault-research",
  "hub:vault-ops",
] as const;

function exclusivePeers(
  ids: readonly string[]
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const id of ids) {
    out[id] = ids.filter((peer) => peer !== id);
  }
  return out;
}

/** Expanding any surface root collapses every other owner's surface roots. */
function exclusiveOwnerSurfacePeers(): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (let i = 0; i < OWNER_SURFACE_WINGS.length; i++) {
    const wing = OWNER_SURFACE_WINGS[i]!;
    const peers = OWNER_SURFACE_WINGS.flatMap((w, j) => (j === i ? [] : [...w]));
    for (const id of wing) out[id] = peers;
  }
  return out;
}

/**
 * Expanding one of these collapses its peer(s).
 * Owner surface / Vault pairs are owner mirrors (You, Intelligence, Research, Ops).
 * Workspace and Marketplace branches are distinct trees; exclusive open keeps depth readable.
 */
const TREE_PEERS: Record<string, readonly string[]> = {
  ...exclusiveOwnerSurfacePeers(),
  ...exclusivePeers(VAULT_TREE_IDS),
  "hub:ws-personal": ["hub:ws-project-alpha", "hub:ws-family"],
  "hub:ws-project-alpha": ["hub:ws-personal", "hub:ws-family"],
  "hub:ws-family": ["hub:ws-personal", "hub:ws-project-alpha"],
  "hub:marketplace-official": [
    "hub:marketplace-community",
    "hub:marketplace-local",
    "hub:marketplace-installed",
    "hub:marketplace-sell",
  ],
  "hub:marketplace-community": [
    "hub:marketplace-official",
    "hub:marketplace-local",
    "hub:marketplace-installed",
    "hub:marketplace-sell",
  ],
  "hub:marketplace-local": [
    "hub:marketplace-official",
    "hub:marketplace-community",
    "hub:marketplace-installed",
    "hub:marketplace-sell",
  ],
  "hub:marketplace-installed": [
    "hub:marketplace-official",
    "hub:marketplace-community",
    "hub:marketplace-local",
    "hub:marketplace-sell",
  ],
  "hub:marketplace-sell": [
    "hub:marketplace-official",
    "hub:marketplace-community",
    "hub:marketplace-local",
    "hub:marketplace-installed",
  ],
};

export type GraphScene3DHandle = {
  fitAll: () => void;
  reset: () => void;
  /** Zoom the camera onto one node (keeps it in the open strip between side panels). */
  focusNode: (nodeId: string) => void;
  /** Highlight a node and frame it (same as clicking the glyph). */
  selectNode: (nodeId: string) => void;
};

type Vec3 = { x: number; y: number; z: number };

function nodePosition(node: GraphProjectionNode): THREE.Vector3 {
  const p = node.position ?? { x: 0, y: 0, z: 0 };
  return new THREE.Vector3(p.x, p.y, p.z ?? 0);
}

function boundsForNodes(nodes: GraphProjectionNode[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const n of nodes) {
    box.expandByPoint(nodePosition(n));
  }
  if (box.isEmpty()) {
    box.setFromCenterAndSize(DEFAULT_TARGET, new THREE.Vector3(2, 2, 2));
  } else {
    box.expandByScalar(0.85);
  }
  return box;
}

/** Shared hit geometry for pointer events under Html glyphs. */
const HIT_GEO = new THREE.SphereGeometry(0.42, 6, 6);

function KeyboardTruck({
  controlsRef,
  enabled,
}: {
  controlsRef: React.RefObject<CameraControlsImpl | null>;
  enabled: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const pressed = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
  });

  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };
    const setKey = (code: string, down: boolean) => {
      const k = code.toLowerCase();
      if (k === "w" || k === "arrowup") pressed.current.w = down;
      if (k === "a" || k === "arrowleft") pressed.current.a = down;
      if (k === "s" || k === "arrowdown") pressed.current.s = down;
      if (k === "d" || k === "arrowright") pressed.current.d = down;
      if (k === "q") pressed.current.q = down;
      if (k === "e") pressed.current.e = down;
    };
    const onDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      setKey(e.key, true);
      invalidate();
    };
    const onUp = (e: KeyboardEvent) => setKey(e.key, false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [invalidate]);

  useFrame((_, dt) => {
    if (!enabled) return;
    const c = controlsRef.current;
    if (!c) return;
    const p = pressed.current;
    if (!(p.a || p.d || p.w || p.s || p.q || p.e)) return;
    const speed = 2.4 * dt;
    if (p.a) c.truck(-speed, 0, false);
    if (p.d) c.truck(speed, 0, false);
    if (p.w) c.forward(speed, false);
    if (p.s) c.forward(-speed, false);
    if (p.q) c.elevate(-speed, false);
    if (p.e) c.elevate(speed, false);
    invalidate();
  });

  return null;
}

function NodeGlyph({
  node,
  position,
  color,
  selected,
  adjacent,
  collapsed,
  collapsible,
  onSelect,
  onActivate,
  onToggleCollapse,
  onNudge,
  setCameraEnabled,
}: {
  node: GraphProjectionNode;
  position: Vec3;
  color: string;
  selected: boolean;
  adjacent: boolean;
  collapsed: boolean;
  collapsible: boolean;
  onSelect: (node: GraphProjectionNode) => void;
  onActivate: (node: GraphProjectionNode) => void;
  onToggleCollapse: (nodeId: string) => void;
  onNudge: (nodeId: string, delta: Vec3) => void;
  setCameraEnabled: (on: boolean) => void;
}) {
  const { camera, size } = useThree();
  const dragging = useRef(false);
  const primary =
    node.kind === "user" ||
    node.kind === "agent" ||
    node.kind === "chat" ||
    node.kind === "system" ||
    node.id.startsWith("hub:");
  const distanceFactor = 6.2;

  const handleSelect = (e: {
    stopPropagation: () => void;
    altKey?: boolean;
    nativeEvent?: { altKey?: boolean };
  }) => {
    e.stopPropagation();
    const alt = Boolean(e.altKey ?? e.nativeEvent?.altKey);
    onSelect(node);
    if (alt && collapsible) onToggleCollapse(node.id);
    invalidate();
  };

  const onPointerDown = (e: {
    stopPropagation: () => void;
    shiftKey: boolean;
    button: number;
  }) => {
    if (e.button !== 0 || !e.shiftKey) return;
    e.stopPropagation();
    dragging.current = true;
    setCameraEnabled(false);
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setCameraEnabled(true);
    invalidate();
  };

  const onPointerMove = (e: {
    movementX: number;
    movementY: number;
    stopPropagation: () => void;
  }) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const dist = camera.position.distanceTo(
      new THREE.Vector3(position.x, position.y, position.z)
    );
    const scale = (dist * 0.0025) / Math.max(size.height / 900, 0.5);
    onNudge(node.id, {
      x: e.movementX * scale,
      y: -e.movementY * scale,
      z: 0,
    });
    invalidate();
  };

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh
        visible={false}
        geometry={HIT_GEO}
        onClick={handleSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onActivate(node);
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerUp}
      >
        <meshBasicMaterial />
      </mesh>
      <Html
        center
        sprite
        transform={false}
        occlude={false}
        distanceFactor={distanceFactor}
        zIndexRange={[100, 0]}
        style={{ pointerEvents: "auto", willChange: "transform" }}
      >
        <GraphNodeGlyph
          kind={node.kind}
          nodeId={node.id}
          objectType={node.objectType}
          color={color}
          label={node.label}
          selected={selected}
          adjacent={adjacent}
          muted={!selected && !adjacent && !primary}
          attention={Boolean(node.status?.attention)}
          working={Boolean(node.status?.working)}
          collapsible={collapsible}
          collapsed={collapsed}
          onToggleCollapse={() => onToggleCollapse(node.id)}
          aria-label={`${node.kind}: ${node.label}${collapsed ? " (collapsed)" : ""}`}
          onClick={handleSelect}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onActivate(node);
          }}
          onPointerDown={(e) => {
            if (!e.shiftKey) return;
            e.stopPropagation();
            dragging.current = true;
            setCameraEnabled(false);
          }}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            e.stopPropagation();
            const dist = camera.position.distanceTo(
              new THREE.Vector3(position.x, position.y, position.z)
            );
            const scale = (dist * 0.0025) / Math.max(size.height / 900, 0.5);
            onNudge(node.id, {
              x: e.movementX * scale,
              y: -e.movementY * scale,
              z: 0,
            });
            invalidate();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onActivate(node);
            }
            if ((e.key === "c" || e.key === "C") && collapsible) {
              e.preventDefault();
              onToggleCollapse(node.id);
            }
          }}
        />
      </Html>
    </group>
  );
}

/** One LineSegments draw for all non-highlighted edges (far cheaper than N Lines). */
function EdgeBatch({
  edges,
  positions,
  isLight,
}: {
  edges: Array<{ source: string; target: string }>;
  positions: Map<string, Vec3>;
  isLight: boolean;
}) {
  const geom = useMemo(() => {
    const positionsArr: number[] = [];
    for (const e of edges) {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) continue;
      positionsArr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positionsArr, 3)
    );
    return g;
  }, [edges, positions]);

  useEffect(() => () => geom.dispose(), [geom]);

  if (geom.getAttribute("position").count === 0) return null;
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial
        color={isLight ? "#94a3b8" : "#64748b"}
        transparent
        opacity={isLight ? 0.7 : 0.55}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function EdgeLine({
  source,
  target,
  positions,
  highlighted,
  isLight,
}: {
  source: string;
  target: string;
  positions: Map<string, Vec3>;
  highlighted: boolean;
  isLight: boolean;
}) {
  const ap = positions.get(source);
  const bp = positions.get(target);
  const points = useMemo((): [number, number, number][] | null => {
    if (!ap || !bp) return null;
    return [
      [ap.x, ap.y, ap.z],
      [bp.x, bp.y, bp.z],
    ];
  }, [ap, bp]);
  if (!points) return null;
  return (
    <Line
      points={points}
      color={
        highlighted
          ? isLight
            ? "#475569"
            : "#e2e8f0"
          : isLight
            ? "#94a3b8"
            : "#64748b"
      }
      lineWidth={highlighted ? 2.25 : 1.5}
      transparent
      opacity={highlighted ? 0.95 : isLight ? 0.7 : 0.55}
    />
  );
}

function SceneBody({
  projection,
  selectedId,
  collapsedIds,
  positionOverrides,
  cameraEnabled,
  onSelect,
  onActivate,
  onToggleCollapse,
  onNudge,
  setCameraEnabled,
  lowPower,
  controlsRef,
  background,
}: {
  projection: GraphProjection;
  selectedId: string | null;
  collapsedIds: Set<string>;
  positionOverrides: Record<string, Vec3>;
  cameraEnabled: boolean;
  onSelect: (node: GraphProjectionNode) => void;
  onActivate: (node: GraphProjectionNode) => void;
  onToggleCollapse: (nodeId: string) => void;
  onNudge: (nodeId: string, delta: Vec3) => void;
  setCameraEnabled: (on: boolean) => void;
  lowPower: boolean;
  controlsRef: React.RefObject<CameraControlsImpl | null>;
  background: string;
}) {
  const isLight = background === SCENE_BG_LIGHT;

  const positions = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const n of projection.nodes) {
      const base = n.position ?? { x: 0, y: 0, z: 0 };
      const o = positionOverrides[n.id];
      m.set(n.id, {
        x: o?.x ?? base.x,
        y: o?.y ?? base.y,
        z: o?.z ?? base.z ?? 0,
      });
    }
    return m;
  }, [projection.nodes, positionOverrides]);

  const nodeColors = useMemo(
    () => buildGraphNodeColors(projection.nodes, projection.edges),
    [projection.nodes, projection.edges]
  );

  const hidden = useMemo(
    () => hiddenDescendantIds(projection.edges, collapsedIds),
    [projection.edges, collapsedIds]
  );

  const visibleNodes = useMemo(
    () => projection.nodes.filter((n) => !hidden.has(n.id)),
    [projection.nodes, hidden]
  );

  const visibleEdges = useMemo(
    () =>
      projection.edges.filter(
        (e) => !hidden.has(e.source) && !hidden.has(e.target)
      ),
    [projection.edges, hidden]
  );

  const adjacentIds = useMemo(() => {
    const s = new Set<string>();
    if (!selectedId) return s;
    for (const e of visibleEdges) {
      if (e.source === selectedId) s.add(e.target);
      if (e.target === selectedId) s.add(e.source);
    }
    return s;
  }, [visibleEdges, selectedId]);

  const collapsibleIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of projection.edges) {
      s.add(e.source);
    }
    return s;
  }, [projection.edges]);

  /**
   * Always render SVG Html glyphs for visible nodes. Mesh-sphere LOD was
   * turning default land into colored circles once the open Hub/surface/Vault
   * count exceeded the Html budget and camera fit pushed nodes past maxDist.
   */
  const htmlTick = useRef(0);
  useFrame(() => {
    htmlTick.current += 1;
    const c = controlsRef.current;
    if (c?.active) invalidate();
  });

  const didFit = useRef(false);
  useEffect(() => {
    didFit.current = false;
    invalidate();
  }, [projection.focusId, projection.nodes.length]);

  useEffect(() => {
    invalidate();
  }, [selectedId, collapsedIds, visibleNodes.length]);

  useEffect(() => {
    if (didFit.current) return;
    const c = controlsRef.current;
    if (!c || visibleNodes.length === 0) return;
    const box = boundsForNodes(
      visibleNodes.map((n) => ({
        ...n,
        position: positions.get(n.id) ?? n.position,
      }))
    );
    void c.fitToBox(box, true, {
      cover: false,
      paddingTop: 0.35,
      paddingBottom: 0.35,
      paddingLeft: 0.45,
      paddingRight: 0.45,
    });
    didFit.current = true;
  }, [controlsRef, visibleNodes, positions, projection.focusId]);

  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.enabled = cameraEnabled;
  }, [cameraEnabled, controlsRef]);

  const dimEdges = useMemo(
    () =>
      visibleEdges.filter(
        (e) =>
          !(
            Boolean(selectedId) &&
            (e.source === selectedId ||
              e.target === selectedId ||
              (adjacentIds.has(e.source) && adjacentIds.has(e.target)))
          )
      ),
    [visibleEdges, selectedId, adjacentIds]
  );

  const hiEdges = useMemo(
    () =>
      visibleEdges.filter(
        (e) =>
          Boolean(selectedId) &&
          (e.source === selectedId ||
            e.target === selectedId ||
            (adjacentIds.has(e.source) && adjacentIds.has(e.target)))
      ),
    [visibleEdges, selectedId, adjacentIds]
  );

  return (
    <>
      <color attach="background" args={[background]} />
      <ambientLight intensity={lowPower ? 0.9 : 0.6} />
      {!lowPower ? <pointLight position={[4, 6, 3]} intensity={1.15} /> : null}
      <CameraControls
        ref={controlsRef}
        makeDefault
        minDistance={1.2}
        maxDistance={48}
        dollySpeed={0.85}
        truckSpeed={1.4}
        draggingSmoothTime={0.08}
        mouseButtons={{
          left: CameraControlsImpl.ACTION.TRUCK,
          middle: CameraControlsImpl.ACTION.DOLLY,
          right: CameraControlsImpl.ACTION.ROTATE,
          wheel: CameraControlsImpl.ACTION.DOLLY,
        }}
        touches={{
          one: CameraControlsImpl.ACTION.TOUCH_TRUCK,
          two: CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE,
          three: CameraControlsImpl.ACTION.TOUCH_TRUCK,
        }}
      />
      <KeyboardTruck controlsRef={controlsRef} enabled={cameraEnabled} />
      <EdgeBatch edges={dimEdges} positions={positions} isLight={isLight} />
      {hiEdges.map((e) => (
        <EdgeLine
          key={e.id}
          source={e.source}
          target={e.target}
          positions={positions}
          isLight={isLight}
          highlighted
        />
      ))}
      {visibleNodes.map((n) => (
        <NodeGlyph
          key={n.id}
          node={n}
          position={positions.get(n.id) ?? { x: 0, y: 0, z: 0 }}
          color={nodeColors.get(n.id) ?? graphNodeColor(n.kind, n.id)}
          selected={selectedId === n.id}
          adjacent={adjacentIds.has(n.id)}
          collapsed={collapsedIds.has(n.id)}
          collapsible={collapsibleIds.has(n.id)}
          onSelect={onSelect}
          onActivate={onActivate}
          onToggleCollapse={onToggleCollapse}
          onNudge={onNudge}
          setCameraEnabled={setCameraEnabled}
        />
      ))}
    </>
  );
}

export const GraphScene3D = forwardRef<
  GraphScene3DHandle,
  {
    projection: GraphProjection;
    lowPower: boolean;
    onNodeActivate: (node: GraphProjectionNode) => void;
    /** Called on single click (select). Does not open windows by itself. */
    onNodeSelect?: (node: GraphProjectionNode) => void;
  }
>(function GraphScene3D(
  { projection, lowPower, onNodeActivate, onNodeSelect },
  ref
) {
  const { resolvedTheme } = useTheme();
  const background =
    resolvedTheme === "light" ? SCENE_BG_LIGHT : SCENE_BG_DARK;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    defaultCollapsedSet()
  );
  const [positionOverrides, setPositionOverrides] = useState<
    Record<string, Vec3>
  >({});
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const controlsRef = useRef<CameraControlsImpl | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const collapsedRef = useRef(collapsedIds);
  collapsedRef.current = collapsedIds;

  const fitAll = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    const hidden = hiddenDescendantIds(projection.edges, collapsedRef.current);
    const nodes = projection.nodes
      .filter((n) => !hidden.has(n.id))
      .map((n) => {
        const o = positionOverrides[n.id];
        if (!o) return n;
        return {
          ...n,
          position: {
            x: o.x,
            y: o.y,
            z: o.z,
          },
        };
      });
    const box = boundsForNodes(nodes);
    void c.fitToBox(box, true, {
      cover: false,
      paddingTop: 0.35,
      paddingBottom: 0.35,
      paddingLeft: 0.45,
      paddingRight: 0.45,
    });
  }, [projection.edges, projection.nodes, positionOverrides]);

  const reset = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    setPositionOverrides({});
    const collapsed = defaultCollapsedSet();
    setCollapsedIds(collapsed);
    const hidden = hiddenDescendantIds(projection.edges, collapsed);
    const nodes = projection.nodes.filter((n) => !hidden.has(n.id));
    const box = boundsForNodes(nodes);
    void c.fitToBox(box, true, {
      cover: false,
      paddingTop: 0.4,
      paddingBottom: 0.4,
      paddingLeft: 0.5,
      paddingRight: 0.5,
    });
  }, [projection.edges, projection.nodes]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const c = controlsRef.current;
      if (!c) return;
      const node = projection.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const o = positionOverrides[nodeId];
      const framed = {
        ...node,
        position: {
          x: o?.x ?? node.position?.x ?? 0,
          y: o?.y ?? node.position?.y ?? 0,
          z: o?.z ?? node.position?.z ?? 0,
        },
      };
      const box = boundsForNodes([framed]);
      // Keep the node readable between left Chat and right Information panels.
      box.expandByScalar(1.15);
      void c.fitToBox(box, true, {
        cover: false,
        paddingTop: 0.65,
        paddingBottom: 0.65,
        paddingLeft: 1.15,
        paddingRight: 1.15,
      });
    },
    [projection.nodes, positionOverrides]
  );

  const selectNode = useCallback(
    (nodeId: string) => {
      if (!projection.nodes.some((n) => n.id === nodeId)) return;
      setSelectedId(nodeId);
      focusNode(nodeId);
    },
    [focusNode, projection.nodes]
  );

  useImperativeHandle(
    ref,
    () => ({ fitAll, reset, focusNode, selectNode }),
    [fitAll, reset, focusNode, selectNode]
  );

  const onSelect = useCallback(
    (node: GraphProjectionNode) => {
      setSelectedId(node.id);
      focusNode(node.id);
      onNodeSelect?.(node);
    },
    [focusNode, onNodeSelect]
  );

  const onToggleCollapse = useCallback((nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        // Expanding: open this tree; collapse peers (mirrors or sibling workspaces).
        next.delete(nodeId);
        for (const peer of TREE_PEERS[nodeId] ?? []) {
          next.add(peer);
        }
      } else {
        // Collapsing: hide this branch; reset nested platform-row expands.
        next.add(nodeId);
        recollapsePlatformRayBeyond(next, nodeId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onExternalToggle = (ev: Event) => {
      const id = (ev as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (typeof id === "string" && id.length > 0) onToggleCollapse(id);
    };
    window.addEventListener("godmode:graph-toggle-collapse", onExternalToggle);
    return () =>
      window.removeEventListener(
        "godmode:graph-toggle-collapse",
        onExternalToggle
      );
  }, [onToggleCollapse]);

  useEffect(() => {
    const onOrganizeCollapse = (ev: Event) => {
      const action = (ev as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "expand-all") {
        setCollapsedIds(new Set());
        return;
      }
      if (action === "collapse-all") {
        const next = new Set<string>();
        for (const e of projection.edges) next.add(e.source);
        setCollapsedIds(next);
        return;
      }
      if (action === "reset-default") {
        setCollapsedIds(defaultCollapsedSet());
      }
    };
    window.addEventListener(
      "godmode:graph-organize-collapse",
      onOrganizeCollapse
    );
    return () =>
      window.removeEventListener(
        "godmode:graph-organize-collapse",
        onOrganizeCollapse
      );
  }, [projection.edges]);

  useEffect(() => {
    const collapsible = new Set<string>();
    for (const e of projection.edges) collapsible.add(e.source);
    window.dispatchEvent(
      new CustomEvent("godmode:graph-collapse-changed", {
        detail: {
          collapsedIds: [...collapsedIds],
          collapsibleIds: [...collapsible],
        },
      })
    );
  }, [collapsedIds, projection.edges]);

  const onNudge = useCallback((nodeId: string, delta: Vec3) => {
    setPositionOverrides((prev) => {
      const node = projection.nodes.find((n) => n.id === nodeId);
      const base = prev[nodeId] ?? {
        x: node?.position?.x ?? 0,
        y: node?.position?.y ?? 0,
        z: node?.position?.z ?? 0,
      };
      return {
        ...prev,
        [nodeId]: {
          x: base.x + delta.x,
          y: base.y + delta.y,
          z: base.z + delta.z,
        },
      };
    });
  }, [projection.nodes]);

  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t.isContentEditable
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const id = selectedIdRef.current;
      if (!id) return;
      if (e.key === "Enter") {
        const node = projection.nodes.find((n) => n.id === id);
        if (node) onNodeActivate(node);
        return;
      }
      if (e.key === "c" || e.key === "C") {
        onToggleCollapse(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNodeActivate, onToggleCollapse, projection.nodes]);

  return (
    <Canvas
      frameloop="demand"
      dpr={lowPower ? [1, 1] : [1, 1.25]}
      camera={{ position: [DEFAULT_EYE.x, DEFAULT_EYE.y, DEFAULT_EYE.z], fov: 50 }}
      gl={{
        antialias: !lowPower,
        powerPreference: "high-performance",
        alpha: false,
        stencil: false,
        depth: true,
      }}
      performance={{ min: 0.5 }}
      className="h-full w-full"
      onPointerMissed={() => {
        setSelectedId(null);
        invalidate();
      }}
    >
      <SceneBody
        projection={projection}
        selectedId={selectedId}
        collapsedIds={collapsedIds}
        positionOverrides={positionOverrides}
        cameraEnabled={cameraEnabled}
        onSelect={onSelect}
        onActivate={onNodeActivate}
        onToggleCollapse={onToggleCollapse}
        onNudge={onNudge}
        setCameraEnabled={setCameraEnabled}
        lowPower={lowPower}
        controlsRef={controlsRef}
        background={background}
      />
    </Canvas>
  );
});
