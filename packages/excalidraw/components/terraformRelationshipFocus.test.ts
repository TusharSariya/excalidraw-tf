import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  applyTerraformRelationshipFocus,
  getTerraformRelationshipFocus,
} from "./terraformRelationshipFocus";
import { terraformVpceSgLayoutElementId } from "./terraformTopologySgLinks";
import { washHexColor } from "./terraformColorWash";

const VIEW_BG = "#ffffff";

/**
 * Color washing levels mirror the constants in `terraformRelationshipFocus.ts`. A
 * `level` of 100 means "no dimming" (so stroke / background stay as-is); below 100
 * the stroke color is blended toward the canvas background by `(100 - level) / 100`.
 */
const expectedWashedStroke = (level: number, baseColor = "#000000") =>
  washHexColor(baseColor, (100 - level) / 100, VIEW_BG);

/** Transparent backgrounds become an opaque washed fill (the user's "fully hides what's behind" requirement). */
const expectedWashedTransparentBackground = (level: number) =>
  washHexColor("transparent", (100 - level) / 100, VIEW_BG);

const baseElement = (
  id: string,
  customData: Record<string, any>,
  overrides: Partial<ExcalidrawElement> = {},
) =>
  ({
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData,
    ...overrides,
  } as ExcalidrawElement);

const resource = (
  nodePath: string,
  overrides: Partial<ExcalidrawElement> = {},
  opts?: { semantic?: boolean; primary?: boolean; expandAllView?: boolean },
) =>
  baseElement(
    `node:${nodePath}`,
    {
      terraform: true,
      terraformVisibilityRole: "resource",
      nodePath,
      ...(opts?.semantic
        ? {
            terraformSemanticOverview: true,
            terraformExpandAllView: opts.expandAllView === true,
          }
        : {}),
      ...(opts?.primary === true ? { terraformInitiallyVisible: true } : {}),
      ...(opts?.primary === false ? { terraformInitiallyVisible: false } : {}),
    },
    overrides,
  );

const edge = (
  id: string,
  layer: "dependency" | "dataFlow",
  source: string,
  target: string,
  overrides: Partial<ExcalidrawElement> = {},
  relationshipOverrides: Record<string, any> = {},
) =>
  baseElement(
    id,
    {
      terraformEdgeLayer: layer,
      relationship: {
        source,
        target,
        ...relationshipOverrides,
      },
    },
    {
      type: "arrow",
      ...overrides,
    },
  );

const group = (
  id: string,
  childKeys: string[],
  overrides: Partial<ExcalidrawElement> = {},
  semantic = false,
) =>
  baseElement(
    id,
    {
      terraformModuleGroup: true,
      terraformGroupChildKeys: childKeys,
      ...(semantic ? { terraformSemanticOverview: true } : {}),
    },
    overrides,
  );

const semanticEdge = (
  id: string,
  layer: "dependency" | "dataFlow",
  source: string,
  target: string,
  overrides: Partial<ExcalidrawElement> = {},
  relationshipOverrides: Record<string, any> = {},
) =>
  baseElement(
    id,
    {
      terraform: true,
      terraformSemanticOverview: true,
      terraformEdgeLayer: layer,
      relationship: {
        source,
        target,
        ...relationshipOverrides,
      },
    },
    {
      type: "arrow",
      ...overrides,
    },
  );

describe("terraform relationship focus", () => {
  it("reveals bound label when it lacks nodePath but its container is a related resource", () => {
    const rectSg = resource("aws_security_group.sg", {
      id: "rect:sg",
      isDeleted: true,
    });
    const labelText = baseElement(
      "text:sg",
      { terraform: true, terraformVisibilityRole: "resource" },
      {
        type: "text",
        containerId: "rect:sg",
        isDeleted: true,
        width: 80,
        height: 20,
        fontSize: 12,
        originalText: "aws_security_group.sg",
        text: "aws_security_group.sg",
      },
    );

    const elements = [
      resource("aws_instance.web"),
      rectSg,
      labelText,
      edge(
        "edge:web-sg",
        "dependency",
        "aws_instance.web",
        "aws_security_group.sg",
        { isDeleted: true },
      ),
    ];

    const result = applyTerraformRelationshipFocus(
      elements,
      "aws_instance.web",
      VIEW_BG,
    );
    const byId = new Map(result.elements.map((e) => [e.id, e]));

    expect(byId.get("rect:sg")?.isDeleted).toBe(false);
    expect(byId.get("text:sg")?.isDeleted).toBe(false);
    expect(byId.get("text:sg")?.opacity).toBe(100);
    expect(byId.get("text:sg")?.strokeColor).toBe("#000000");
  });

  it("reveals the multi-hop dependency neighborhood with degree-of-interest falloff", () => {
    const elements = [
      resource("aws_instance.web"),
      resource("aws_security_group.sg", { isDeleted: true }),
      resource("aws_vpc.main"),
      edge(
        "edge:web-sg",
        "dependency",
        "aws_instance.web",
        "aws_security_group.sg",
        { isDeleted: true },
      ),
      edge(
        "edge:sg-vpc",
        "dependency",
        "aws_security_group.sg",
        "aws_vpc.main",
      ),
    ];

    const result = applyTerraformRelationshipFocus(
      elements,
      "aws_instance.web",
      VIEW_BG,
    );
    const byId = new Map(
      result.elements.map((element) => [element.id, element]),
    );

    expect(byId.get("edge:web-sg")?.isDeleted).toBe(false);
    expect(byId.get("edge:web-sg")?.opacity).toBe(100);
    expect(byId.get("edge:web-sg")?.strokeColor).toBe(expectedWashedStroke(85));
    expect(byId.get("edge:web-sg")?.customData?.terraformFocusPreview).toBe(
      true,
    );
    expect(byId.get("node:aws_security_group.sg")?.isDeleted).toBe(false);
    expect(
      byId.get("node:aws_security_group.sg")?.customData?.terraformFocusPreview,
    ).toBe(true);
    // aws_vpc.main is two hops out (web → sg → vpc): revealed at the farther
    // degree-of-interest level, and the sg→vpc edge lights as in-neighborhood.
    expect(byId.get("edge:sg-vpc")?.opacity).toBe(100);
    expect(byId.get("edge:sg-vpc")?.strokeColor).toBe(expectedWashedStroke(85));
    expect(byId.get("node:aws_vpc.main")?.opacity).toBe(100);
    expect(byId.get("node:aws_vpc.main")?.strokeColor).toBe(
      expectedWashedStroke(55),
    );
  });

  it("includes hidden data-flow edges touching the focus node", () => {
    const elements = [
      resource("aws_lambda_function.fn"),
      resource("aws_cloudwatch_log_group.logs", { isDeleted: true }),
      edge(
        "edge:fn-logs",
        "dataFlow",
        "aws_lambda_function.fn",
        "aws_cloudwatch_log_group.logs",
        { isDeleted: true },
      ),
    ];

    const result = applyTerraformRelationshipFocus(
      elements,
      "aws_lambda_function.fn",
      VIEW_BG,
    );
    const byId = new Map(
      result.elements.map((element) => [element.id, element]),
    );

    expect(byId.get("edge:fn-logs")?.isDeleted).toBe(false);
    expect(byId.get("edge:fn-logs")?.opacity).toBe(100);
    expect(byId.get("edge:fn-logs")?.strokeColor).toBe(
      expectedWashedStroke(85),
    );
    expect(byId.get("node:aws_cloudwatch_log_group.logs")?.isDeleted).toBe(
      false,
    );
  });

  it("keeps bound label text at full color when the resource rectangle is dimmed", () => {
    const rectS3 = resource("aws_s3_bucket.logs", { id: "rect:s3" });
    const labelText = baseElement(
      "text:s3",
      {
        terraform: true,
        nodePath: "aws_s3_bucket.logs",
        terraformVisibilityRole: "resource",
      },
      {
        type: "text",
        containerId: "rect:s3",
        width: 80,
        height: 20,
        fontSize: 12,
        originalText: "aws_s3_bucket.logs",
        text: "aws_s3_bucket.logs",
      },
    );

    const elements = [
      resource("aws_instance.web"),
      resource("aws_security_group.sg"),
      rectS3,
      labelText,
      edge(
        "edge:link",
        "dependency",
        "aws_instance.web",
        "aws_security_group.sg",
      ),
    ];

    const result = applyTerraformRelationshipFocus(
      elements,
      "aws_instance.web",
      VIEW_BG,
    );
    const byId = new Map(result.elements.map((e) => [e.id, e]));

    expect(byId.get("rect:s3")?.opacity).toBe(100);
    expect(byId.get("rect:s3")?.strokeColor).toBe(expectedWashedStroke(25));
    expect(byId.get("text:s3")?.opacity).toBe(100);
    expect(byId.get("text:s3")?.strokeColor).toBe("#000000");
  });

  it("dims unrelated Terraform resources, groups, and edges", () => {
    const elements = [
      resource("aws_instance.web"),
      resource("aws_security_group.sg"),
      resource("aws_vpc.main"),
      group("group:focus", ["aws_instance.web", "aws_security_group.sg"]),
      group("group:other", ["aws_vpc.main"]),
      edge(
        "edge:web-sg",
        "dependency",
        "aws_instance.web",
        "aws_security_group.sg",
      ),
      edge("edge:other", "dataFlow", "aws_vpc.main", "aws_subnet.private"),
    ];

    const result = applyTerraformRelationshipFocus(
      elements,
      "aws_instance.web",
      VIEW_BG,
    );
    const byId = new Map(
      result.elements.map((element) => [element.id, element]),
    );

    for (const id of [
      "node:aws_instance.web",
      "node:aws_security_group.sg",
      "edge:web-sg",
      "group:focus",
      "node:aws_vpc.main",
      "group:other",
      "edge:other",
    ]) {
      expect(byId.get(id)?.opacity).toBe(100);
    }

    expect(byId.get("node:aws_instance.web")?.strokeColor).toBe("#000000");
    expect(byId.get("node:aws_security_group.sg")?.strokeColor).toBe(
      expectedWashedStroke(85),
    );
    expect(byId.get("edge:web-sg")?.strokeColor).toBe(expectedWashedStroke(85));
    expect(byId.get("group:focus")?.strokeColor).toBe(expectedWashedStroke(60));
    expect(byId.get("node:aws_vpc.main")?.strokeColor).toBe(
      expectedWashedStroke(25),
    );
    expect(byId.get("group:other")?.strokeColor).toBe(expectedWashedStroke(25));
    expect(byId.get("edge:other")?.strokeColor).toBe(expectedWashedStroke(15));
  });

  it("turns transparent backgrounds opaque so dimmed elements fully hide what's behind", () => {
    const elements = [
      resource("aws_instance.web"),
      resource("aws_vpc.main"),
      group("group:other", ["aws_vpc.main"]),
    ];

    const result = applyTerraformRelationshipFocus(
      elements,
      "aws_instance.web",
      VIEW_BG,
    );
    const byId = new Map(
      result.elements.map((element) => [element.id, element]),
    );

    const dimmedNode = byId.get("node:aws_vpc.main");
    expect(dimmedNode?.backgroundColor).toBe(
      expectedWashedTransparentBackground(25),
    );
    expect(dimmedNode?.backgroundColor).not.toBe("transparent");
    expect(dimmedNode?.fillStyle).toBe("solid");

    const dimmedGroup = byId.get("group:other");
    expect(dimmedGroup?.backgroundColor).toBe(
      expectedWashedTransparentBackground(25),
    );
    expect(dimmedGroup?.backgroundColor).not.toBe("transparent");
    expect(dimmedGroup?.fillStyle).toBe("solid");
  });

  it("re-dimming after a level change blends from the canonical originals, not the washed value", () => {
    const elements = [
      resource("aws_instance.web", {
        strokeColor: "#112233",
        backgroundColor: "#ffaabb",
        fillStyle: "hachure",
      }),
      resource("aws_security_group.sg", {
        strokeColor: "#112233",
        backgroundColor: "#ffaabb",
        fillStyle: "hachure",
      }),
      resource("aws_vpc.main", {
        strokeColor: "#112233",
        backgroundColor: "#ffaabb",
        fillStyle: "hachure",
      }),
    ];

    const focusedOnWeb = applyTerraformRelationshipFocus(
      elements,
      "aws_instance.web",
      VIEW_BG,
    ).elements;
    const focusedOnSg = applyTerraformRelationshipFocus(
      focusedOnWeb,
      "aws_security_group.sg",
      VIEW_BG,
    ).elements;
    const byId = new Map(focusedOnSg.map((e) => [e.id, e]));

    expect(byId.get("node:aws_security_group.sg")?.strokeColor).toBe("#112233");
    expect(byId.get("node:aws_security_group.sg")?.backgroundColor).toBe(
      "#ffaabb",
    );
    expect(byId.get("node:aws_security_group.sg")?.fillStyle).toBe("hachure");

    const dimmedVpc = byId.get("node:aws_vpc.main");
    expect(dimmedVpc?.strokeColor).toBe(washHexColor("#112233", 0.75, VIEW_BG));
    expect(dimmedVpc?.backgroundColor).toBe(
      washHexColor("#ffaabb", 0.75, VIEW_BG),
    );
    expect(dimmedVpc?.fillStyle).toBe("hachure");
  });

  it("clearing focus restores stroke/background/fillStyle and clears the originals stash", () => {
    const original = [
      resource("aws_instance.web", {
        strokeColor: "#123456",
        backgroundColor: "#fedcba",
        fillStyle: "cross-hatch",
      }),
      resource("aws_security_group.sg", {
        strokeColor: "#123456",
        backgroundColor: "#fedcba",
        fillStyle: "cross-hatch",
        isDeleted: true,
      }),
      resource("aws_vpc.main", {
        strokeColor: "#123456",
        backgroundColor: "#fedcba",
        fillStyle: "cross-hatch",
      }),
      baseElement("freehand:note", {}, { opacity: 40 }),
      edge(
        "edge:web-sg",
        "dependency",
        "aws_instance.web",
        "aws_security_group.sg",
        {
          isDeleted: true,
          strokeColor: "#123456",
          backgroundColor: "#fedcba",
          fillStyle: "cross-hatch",
        },
      ),
    ];

    const focused = applyTerraformRelationshipFocus(
      original,
      "aws_instance.web",
      VIEW_BG,
    ).elements;

    const cleared = applyTerraformRelationshipFocus(focused, null, VIEW_BG);
    const byId = new Map(
      cleared.elements.map((element) => [element.id, element]),
    );

    expect(byId.get("node:aws_security_group.sg")?.isDeleted).toBe(true);
    expect(byId.get("edge:web-sg")?.isDeleted).toBe(true);
    expect(byId.get("node:aws_instance.web")?.isDeleted).toBe(false);
    expect(byId.get("node:aws_vpc.main")?.isDeleted).toBe(false);

    for (const id of [
      "node:aws_instance.web",
      "node:aws_vpc.main",
      "edge:web-sg",
      "node:aws_security_group.sg",
    ]) {
      const el = byId.get(id);
      expect(el?.opacity).toBe(100);
      expect(el?.strokeColor).toBe("#123456");
      expect(el?.backgroundColor).toBe("#fedcba");
      expect(el?.fillStyle).toBe("cross-hatch");
      expect(el?.customData?.terraformDimmedOriginals).toBeUndefined();
    }

    expect(byId.get("freehand:note")?.opacity).toBe(40);
    expect(
      [...byId.values()].some(
        (element) => element.customData?.terraformFocusPreview === true,
      ),
    ).toBe(false);
  });

  it("detects coalesced dependency edges using direction endpoint hints", () => {
    const elements = [
      resource("aws_instance.web"),
      resource("aws_security_group.sg"),
      edge(
        "edge:coalesced",
        "dependency",
        "module.network",
        "module.compute",
        {},
        {
          directions: [
            {
              source: "aws_security_group.sg",
              target: "aws_instance.web",
            },
          ],
        },
      ),
    ];

    const focus = getTerraformRelationshipFocus(elements, "aws_instance.web");

    expect(focus.focusedEdgeIds.has("edge:coalesced")).toBe(true);
    expect(focus.relatedNodePaths.has("aws_security_group.sg")).toBe(true);
  });

  it("detects coalesced data-flow edges using direction endpoint hints", () => {
    const elements = [
      resource("aws_instance.web"),
      resource("aws_security_group.sg"),
      edge(
        "edge:coalesced-df",
        "dataFlow",
        "module.network",
        "module.compute",
        {},
        {
          directions: [
            {
              source: "aws_security_group.sg",
              target: "aws_instance.web",
            },
          ],
        },
      ),
    ];

    const focus = getTerraformRelationshipFocus(elements, "aws_instance.web");

    expect(focus.focusedEdgeIds.has("edge:coalesced-df")).toBe(true);
    expect(focus.relatedNodePaths.has("aws_security_group.sg")).toBe(true);
  });

  it("washes co-highlighted duplicate layout tiles that share a canonical nodePath when focus is a layout instance id", () => {
    const layoutKeyA = terraformVpceSgLayoutElementId(
      'aws_vpc_endpoint.ep["a"]',
      "aws_security_group.sg",
    );
    const layoutKeyB = terraformVpceSgLayoutElementId(
      'aws_vpc_endpoint.ep["b"]',
      "aws_security_group.sg",
    );
    const elements = [
      baseElement(
        "rect:a",
        {
          terraform: true,
          terraformVisibilityRole: "resource",
          terraformVisibilityKey: layoutKeyA,
          nodePath: "aws_security_group.sg",
          terraformSemanticLayoutDuplicate: true,
        },
        { type: "rectangle" },
      ),
      baseElement(
        "rect:b",
        {
          terraform: true,
          terraformVisibilityRole: "resource",
          terraformVisibilityKey: layoutKeyB,
          nodePath: "aws_security_group.sg",
          terraformSemanticLayoutDuplicate: true,
        },
        { type: "rectangle" },
      ),
      resource("aws_lambda_function.fn"),
    ];

    const out = applyTerraformRelationshipFocus(
      elements,
      layoutKeyA,
      VIEW_BG,
    ).elements;
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get("rect:a")?.strokeColor).toBe("#000000");
    expect(byId.get("rect:b")?.strokeColor).toBe(
      expectedWashedStroke(85, "#000000"),
    );
  });

  describe("semantic overview (topology) ambient washing", () => {
    it("applies dim edges and primary vs non-primary nodes when focus clears", () => {
      const focused = applyTerraformRelationshipFocus(
        [
          resource("aws_instance.web", {}, { semantic: true, primary: true }),
          resource("aws_vpc.main", {}, { semantic: true, primary: false }),
          semanticEdge(
            "edge:web-vpc",
            "dependency",
            "aws_instance.web",
            "aws_vpc.main",
          ),
        ],
        "aws_instance.web",
        VIEW_BG,
      ).elements;

      const cleared = applyTerraformRelationshipFocus(focused, null, VIEW_BG);
      const byId = new Map(cleared.elements.map((e) => [e.id, e]));

      expect(byId.get("node:aws_instance.web")?.opacity).toBe(100);
      expect(byId.get("node:aws_instance.web")?.strokeColor).toBe("#000000");
      expect(byId.get("node:aws_vpc.main")?.opacity).toBe(100);
      expect(byId.get("node:aws_vpc.main")?.strokeColor).toBe(
        expectedWashedStroke(35),
      );
      expect(byId.get("edge:web-vpc")?.opacity).toBe(100);
      expect(byId.get("edge:web-vpc")?.strokeColor).toBe(
        expectedWashedStroke(22),
      );
    });

    it("with expand-all view, non-primary resources return to full color when focus clears", () => {
      const focused = applyTerraformRelationshipFocus(
        [
          resource(
            "aws_instance.web",
            {},
            {
              semantic: true,
              primary: true,
              expandAllView: true,
            },
          ),
          resource(
            "aws_vpc.main",
            {},
            {
              semantic: true,
              primary: false,
              expandAllView: true,
            },
          ),
          semanticEdge(
            "edge:web-vpc",
            "dependency",
            "aws_instance.web",
            "aws_vpc.main",
          ),
        ],
        "aws_instance.web",
        VIEW_BG,
      ).elements;

      const cleared = applyTerraformRelationshipFocus(focused, null, VIEW_BG);
      const byId = new Map(cleared.elements.map((e) => [e.id, e]));

      expect(byId.get("node:aws_instance.web")?.opacity).toBe(100);
      expect(byId.get("node:aws_instance.web")?.strokeColor).toBe("#000000");
      expect(byId.get("node:aws_vpc.main")?.opacity).toBe(100);
      expect(byId.get("node:aws_vpc.main")?.strokeColor).toBe("#000000");
      expect(byId.get("edge:web-vpc")?.opacity).toBe(100);
      expect(byId.get("edge:web-vpc")?.strokeColor).toBe(
        expectedWashedStroke(22),
      );
    });

    it("dims terraform module groups when focus clears", () => {
      const clearedElements = applyTerraformRelationshipFocus(
        [
          resource("aws_instance.web", {}, { semantic: true, primary: true }),
          group("group:a", ["aws_instance.web"], {}, true),
        ],
        null,
        VIEW_BG,
      ).elements;
      const byId = new Map(clearedElements.map((e) => [e.id, e]));
      expect(byId.get("group:a")?.opacity).toBe(100);
      expect(byId.get("group:a")?.strokeColor).toBe(expectedWashedStroke(68));
    });
  });

  describe("directed traversal (declared-dependency direction)", () => {
    /**
     * Diamond + cycle + upstream-referrer fixture over declared-dependency
     * edges (`relationship.source` references `relationship.target`):
     *
     *   z → a                     (z declares a dependency on a)
     *   a → b, a → c, b → d, c → d   (diamond)
     *   d → e, e → f, f → d          (cycle; f is 4 hops from a)
     *   iso1 → iso2                  (disconnected from a entirely)
     */
    const diamondCycleElements = () => [
      resource("a"),
      resource("b"),
      resource("c"),
      resource("d"),
      resource("e"),
      resource("f"),
      resource("z"),
      resource("iso1"),
      resource("iso2"),
      edge("edge:z-a", "dependency", "z", "a"),
      edge("edge:a-b", "dependency", "a", "b"),
      edge("edge:a-c", "dependency", "a", "c"),
      edge("edge:b-d", "dependency", "b", "d"),
      edge("edge:c-d", "dependency", "c", "d"),
      edge("edge:d-e", "dependency", "d", "e"),
      edge("edge:e-f", "dependency", "e", "f"),
      edge("edge:f-d", "dependency", "f", "d"),
      edge("edge:iso", "dependency", "iso1", "iso2"),
    ];
    const NODE_PATHS = ["a", "b", "c", "d", "e", "f", "z", "iso1", "iso2"];

    const stripNondeterministic = (elements: readonly ExcalidrawElement[]) =>
      elements.map(({ versionNonce, updated, ...rest }) => rest);

    it("golden: options omitted, empty options, and direction 'both' are deep-equal (get)", () => {
      const elements = diamondCycleElements();
      const legacy = getTerraformRelationshipFocus(elements, "a");
      const emptyOptions = getTerraformRelationshipFocus(elements, "a", 3, {});
      const explicitBoth = getTerraformRelationshipFocus(elements, "a", 3, {
        direction: "both",
      });

      expect(emptyOptions).toEqual(legacy);
      expect(explicitBoth).toEqual(legacy);

      // Lock the legacy behavior itself: undirected, 3-hop cap. From `a`,
      // the undirected 3-hop ball is {a, z, b, c, d, e, f-via-f→d(3 hops)}.
      expect(legacy.nodeDistance.get("a")).toBe(0);
      expect(legacy.nodeDistance.get("z")).toBe(1);
      expect(legacy.nodeDistance.get("b")).toBe(1);
      expect(legacy.nodeDistance.get("c")).toBe(1);
      expect(legacy.nodeDistance.get("d")).toBe(2);
      expect(legacy.nodeDistance.get("e")).toBe(3);
      expect(legacy.nodeDistance.get("f")).toBe(3);
      expect(legacy.nodeDistance.has("iso1")).toBe(false);
      expect(legacy.nodeDistance.has("iso2")).toBe(false);
    });

    it("golden: apply with options omitted / empty / 'both' produces deep-equal elements", () => {
      const legacy = applyTerraformRelationshipFocus(
        diamondCycleElements(),
        "a",
        VIEW_BG,
      );
      const emptyOptions = applyTerraformRelationshipFocus(
        diamondCycleElements(),
        "a",
        VIEW_BG,
        {},
      );
      const explicitDefaults = applyTerraformRelationshipFocus(
        diamondCycleElements(),
        "a",
        VIEW_BG,
        { direction: "both", maxHops: 3 },
      );

      expect(legacy.didChange).toBe(true);
      expect(emptyOptions.didChange).toBe(true);
      expect(explicitDefaults.didChange).toBe(true);
      // versionNonce/updated are freshly generated per newElementWith call, so
      // strip them; everything visible (colors, opacity, isDeleted, customData)
      // must be byte-identical.
      expect(stripNondeterministic(emptyOptions.elements)).toEqual(
        stripNondeterministic(legacy.elements),
      );
      expect(stripNondeterministic(explicitDefaults.elements)).toEqual(
        stripNondeterministic(legacy.elements),
      );
    });

    it("dependencies mode with maxHops Infinity reaches the full forward cone and terminates on cycles", () => {
      const focus = getTerraformRelationshipFocus(
        diamondCycleElements(),
        "a",
        3,
        { direction: "dependencies", maxHops: Infinity },
      );

      // Forward cone of `a` along declared source→target: diamond + cycle.
      expect(focus.nodeDistance.get("a")).toBe(0);
      expect(focus.nodeDistance.get("b")).toBe(1);
      expect(focus.nodeDistance.get("c")).toBe(1);
      expect(focus.nodeDistance.get("d")).toBe(2);
      expect(focus.nodeDistance.get("e")).toBe(3);
      expect(focus.nodeDistance.get("f")).toBe(4);
      // NOT in the forward cone: the referrer `z` and the disconnected pair.
      expect(focus.nodeDistance.has("z")).toBe(false);
      expect(focus.nodeDistance.has("iso1")).toBe(false);
      expect(focus.nodeDistance.has("iso2")).toBe(false);
      expect(focus.focusedEdgeIds.has("edge:z-a")).toBe(false);
      expect(focus.focusedEdgeIds.has("edge:iso")).toBe(false);
      // Every edge inside the cone lights, including the cycle back edge.
      for (const id of [
        "edge:a-b",
        "edge:a-c",
        "edge:b-d",
        "edge:c-d",
        "edge:d-e",
        "edge:e-f",
        "edge:f-d",
      ]) {
        expect(focus.focusedEdgeIds.has(id)).toBe(true);
      }
    });

    it("options.maxHops wins over the positional maxHops param", () => {
      const focus = getTerraformRelationshipFocus(
        diamondCycleElements(),
        "a",
        1,
        { direction: "dependencies", maxHops: 2 },
      );
      expect(focus.nodeDistance.get("d")).toBe(2);
      expect(focus.nodeDistance.has("e")).toBe(false);
    });

    it("dependents mode is the exact reverse of dependencies mode on the same fixture", () => {
      const elements = diamondCycleElements();
      const dependenciesCone = new Map(
        NODE_PATHS.map((anchor) => [
          anchor,
          getTerraformRelationshipFocus(elements, anchor, 3, {
            direction: "dependencies",
            maxHops: Infinity,
          }).nodeDistance,
        ]),
      );
      const dependentsCone = new Map(
        NODE_PATHS.map((anchor) => [
          anchor,
          getTerraformRelationshipFocus(elements, anchor, 3, {
            direction: "dependents",
            maxHops: Infinity,
          }).nodeDistance,
        ]),
      );

      // y is reachable from x along declared dependencies iff x is reachable
      // from y along dependents — with the same hop distance.
      for (const x of NODE_PATHS) {
        for (const y of NODE_PATHS) {
          expect(dependentsCone.get(y)!.get(x)).toBe(
            dependenciesCone.get(x)!.get(y),
          );
        }
      }
      // Spot-check: `z` declares a dependency on `a`, so dependents of `a`
      // include `z`, and nothing from the diamond/cycle below `a`.
      const dependentsOfA = dependentsCone.get("a")!;
      expect(dependentsOfA.get("z")).toBe(1);
      expect(dependentsOfA.has("b")).toBe(false);
      expect(dependentsOfA.has("d")).toBe(false);
    });

    it("reveal gating stays <=1 hop even with Infinity hops (nearEdgeIds invariant)", () => {
      const focus = getTerraformRelationshipFocus(
        diamondCycleElements(),
        "a",
        3,
        { direction: "dependencies", maxHops: Infinity },
      );

      // Only edges whose BOTH endpoints are within 1 hop may gate reveal of
      // soft-deleted elements (collapsed-overview visibility reconciler).
      expect([...focus.nearEdgeIds].sort()).toEqual(["edge:a-b", "edge:a-c"]);
      for (const id of focus.nearEdgeIds) {
        expect(focus.focusedEdgeIds.has(id)).toBe(true);
      }
      // Deeper cone edges light but never enter nearEdgeIds.
      expect(focus.nearEdgeIds.has("edge:b-d")).toBe(false);
      expect(focus.nearEdgeIds.has("edge:d-e")).toBe(false);
      expect(focus.nearEdgeIds.has("edge:f-d")).toBe(false);
    });

    it("apply with Infinity hops dims the far cone but never reveals soft-deleted deep elements", () => {
      const elements = [
        resource("a"),
        resource("b", { isDeleted: true }),
        resource("d", { isDeleted: true }),
        edge("edge:a-b", "dependency", "a", "b", { isDeleted: true }),
        edge("edge:b-d", "dependency", "b", "d", { isDeleted: true }),
      ];
      const result = applyTerraformRelationshipFocus(elements, "a", VIEW_BG, {
        direction: "dependencies",
        maxHops: Infinity,
      });
      const byId = new Map(result.elements.map((e) => [e.id, e]));

      // 1-hop neighbor + its edge reveal.
      expect(byId.get("node:b")?.isDeleted).toBe(false);
      expect(byId.get("edge:a-b")?.isDeleted).toBe(false);
      // 2-hop node/edge are in the dim cone but stay soft-deleted.
      expect(byId.get("node:d")?.isDeleted).toBe(true);
      expect(byId.get("edge:b-d")?.isDeleted).toBe(true);
    });

    it("follows relationship.source/target on reversed strata back-edge arrows (C10' — no un-reversal)", () => {
      // Strata's C10' back-edge reversal is rank-only: the drawn arrow may point
      // "up" the layout, but customData.relationship keeps the TRUE declared
      // dependency direction. The directed cone must follow the relationship
      // fields verbatim, regardless of any strata reversal marker.
      const elements = [
        resource("aws_lambda_function.app"),
        resource("aws_sqs_queue.q"),
        edge(
          "edge:back",
          "dependency",
          "aws_lambda_function.app",
          "aws_sqs_queue.q",
          {},
          { strataRankReversed: true },
        ),
      ];

      const deps = getTerraformRelationshipFocus(
        elements,
        "aws_lambda_function.app",
        3,
        { direction: "dependencies", maxHops: Infinity },
      );
      expect(deps.nodeDistance.get("aws_sqs_queue.q")).toBe(1);
      expect(deps.focusedEdgeIds.has("edge:back")).toBe(true);

      const dependents = getTerraformRelationshipFocus(
        elements,
        "aws_lambda_function.app",
        3,
        { direction: "dependents", maxHops: Infinity },
      );
      expect(dependents.nodeDistance.has("aws_sqs_queue.q")).toBe(false);
      expect(dependents.focusedEdgeIds.has("edge:back")).toBe(false);
    });

    it("traverses coalesced hint edges (relationship.directions[]) directionally in both modes", () => {
      // Coalesced module edge whose own endpoints are module paths; the hint
      // says sg references web (declared dependency sg → web).
      const elements = [
        resource("aws_instance.web"),
        resource("aws_security_group.sg"),
        edge(
          "edge:coalesced",
          "dependency",
          "module.network",
          "module.compute",
          {},
          {
            directions: [
              { source: "aws_security_group.sg", target: "aws_instance.web" },
            ],
          },
        ),
      ];

      // dependencies from sg follows the hint source→target.
      const depsFromSg = getTerraformRelationshipFocus(
        elements,
        "aws_security_group.sg",
        3,
        { direction: "dependencies", maxHops: Infinity },
      );
      expect(depsFromSg.nodeDistance.get("aws_instance.web")).toBe(1);
      expect(depsFromSg.focusedEdgeIds.has("edge:coalesced")).toBe(true);

      // dependencies from web must NOT walk the hint backwards.
      const depsFromWeb = getTerraformRelationshipFocus(
        elements,
        "aws_instance.web",
        3,
        { direction: "dependencies", maxHops: Infinity },
      );
      expect(depsFromWeb.nodeDistance.has("aws_security_group.sg")).toBe(false);
      expect(depsFromWeb.focusedEdgeIds.has("edge:coalesced")).toBe(false);

      // dependents from web walks the hint in reverse.
      const dependentsOfWeb = getTerraformRelationshipFocus(
        elements,
        "aws_instance.web",
        3,
        { direction: "dependents", maxHops: Infinity },
      );
      expect(dependentsOfWeb.nodeDistance.get("aws_security_group.sg")).toBe(1);
      expect(dependentsOfWeb.focusedEdgeIds.has("edge:coalesced")).toBe(true);
    });

    it("threads options.maxHops through applyTerraformRelationshipFocus", () => {
      const elements = () => [
        resource("aws_instance.web"),
        resource("aws_security_group.sg"),
        resource("aws_vpc.main"),
        edge(
          "edge:web-sg",
          "dependency",
          "aws_instance.web",
          "aws_security_group.sg",
        ),
        edge(
          "edge:sg-vpc",
          "dependency",
          "aws_security_group.sg",
          "aws_vpc.main",
        ),
      ];

      // Default (3 hops): vpc is 2 hops out → far-related level (55).
      const defaultHops = applyTerraformRelationshipFocus(
        elements(),
        "aws_instance.web",
        VIEW_BG,
      );
      const defaultById = new Map(defaultHops.elements.map((e) => [e.id, e]));
      expect(defaultById.get("node:aws_vpc.main")?.strokeColor).toBe(
        expectedWashedStroke(55),
      );
      expect(defaultById.get("edge:sg-vpc")?.strokeColor).toBe(
        expectedWashedStroke(85),
      );

      // maxHops: 1 threaded through: vpc drops out of the cone → dim level
      // (25), and the sg→vpc edge no longer lights (dim-edge level 15).
      const oneHop = applyTerraformRelationshipFocus(
        elements(),
        "aws_instance.web",
        VIEW_BG,
        { maxHops: 1 },
      );
      const oneHopById = new Map(oneHop.elements.map((e) => [e.id, e]));
      expect(oneHopById.get("node:aws_vpc.main")?.strokeColor).toBe(
        expectedWashedStroke(25),
      );
      expect(oneHopById.get("edge:sg-vpc")?.strokeColor).toBe(
        expectedWashedStroke(15),
      );
    });
  });
});
