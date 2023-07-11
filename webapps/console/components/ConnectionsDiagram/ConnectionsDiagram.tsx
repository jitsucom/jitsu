import React, { ReactNode, RefObject, useEffect } from "react";
import { branding } from "../../lib/branding";
import { requireDefined } from "juava";
import Link from "next/link";
import { useWorkspace } from "../../lib/context";
import { ExternalLink } from "lucide-react";
import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import classNames from "classnames";

export type ConnectorNode = {
  id: string;
  card: (forceSelect: boolean) => ReactNode;
};
export type Actions = {
  title: ReactNode;
  newLink: string;
  editLink: string;
};
export type ConnectionDiagramProps = {
  sources: ConnectorNode[];
  destinations: ConnectorNode[];
  srcActions: Actions;
  dstActions: Actions;
  connections: {
    from: string;
    to: string;
  }[];
};

function indexArray<T extends { id: string }>(arr: T[]): Record<string, number> {
  return arr.reduce((acc, s, idx) => ({ ...acc, [s.id]: idx }), {});
}

export type Point = { left: number; top: number };

export type ConnectorLine = {
  from: Point;
  to: Point;
  selected: boolean;
};

export function getRelativePosition(parent: Element, child: Element): Point {
  const parentRect = parent.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  return {
    left: childRect.left - parentRect.left,
    top: childRect.top - parentRect.top,
  };
}

const Header: React.FC<Actions & { className?: string }> = p => {
  return (
    <div className={classNames(`flex items-center justify-between`, p.className)}>
      <h1 className="text-2xl">{p.title}</h1>
      <div className="space-x-2 flex items-center">
        <Button type="ghost" href={p.editLink}>
          View All
        </Button>
        <Button type="primary" ghost={true} icon={<PlusOutlined />} href={p.newLink}>
          Add
        </Button>
      </div>
    </div>
  );
};

export const ConnectionsDiagram: React.FC<ConnectionDiagramProps> = ({ connections, sources, destinations, ...p }) => {
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const srcRefs = React.useRef<RefObject<HTMLElement>[]>([]);
  const dstRefs = React.useRef<RefObject<HTMLElement>[]>([]);
  const logoRef = React.useRef<HTMLAnchorElement>(null);
  const [windowSize, setWindowSize] = React.useState<{ width: number; height: number } | undefined>();
  const [lines, setLines] = React.useState<ConnectorLine[]>([]);
  const [mouseOverSrc, setMouseOverSrc] = React.useState<string | undefined>();
  const [mouseOverDst, setMouseOverDst] = React.useState<string | undefined>();
  const workspaces = useWorkspace();
  const [forceSelectDestination, setForceSelectDestination] = React.useState<string[]>([]);
  const [forceSelectSource, setForceSelectSource] = React.useState<string[]>([]);
  useEffect(() => {
    const resizeListener = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resizeListener);

    return () => window.removeEventListener("resize", resizeListener);
  });

  useEffect(() => {
    if (canvasRef.current == null || logoRef.current == null) {
      return;
    }
    const logoPosition = getRelativePosition(
      requireDefined(canvasRef.current, `Canvas is not here`),
      requireDefined(logoRef.current, `Logo is not here`)
    );
    const logoBounds = logoRef.current.getBoundingClientRect();
    const newLines: ConnectorLine[] = [];
    srcRefs.current
      .map(r => r.current)
      .filter(r => !!r)
      .forEach((r, idx) => {
        const rel = getRelativePosition(canvasRef.current!, r!);
        const bounds = r!.getBoundingClientRect();
        const source = sources[idx];
        const selected =
          mouseOverSrc === source.id ||
          (!!mouseOverDst && !!connections.find(c => c.from === source.id && c.to === mouseOverDst));
        if (connections.find(c => c.from === source.id)) {
          newLines.push({
            from: { top: rel.top + bounds.height / 2, left: rel.left + bounds.width },
            to: { left: logoPosition.left, top: logoPosition.top + logoBounds.height / 2 },
            selected,
          });
        }
      });

    dstRefs.current
      .map(r => r.current)
      .filter(r => !!r)
      .forEach((r, idx) => {
        const rel = getRelativePosition(canvasRef.current!, r!);
        const bounds = r!.getBoundingClientRect();
        const destination = destinations[idx];
        const selected =
          mouseOverDst === destination.id ||
          (!!mouseOverSrc && !!connections.find(c => c.to === destination.id && c.from === mouseOverSrc));
        if (selected) {
          setForceSelectDestination([destination.id]);
          setForceSelectSource(connections.filter(c => c.to === destination.id).map(c => c.from));
        }
        if (connections.find(c => c.to === destination.id)) {
          newLines.push({
            to: { top: rel.top + bounds.height / 2, left: rel.left },
            from: { left: logoPosition.left + logoBounds.width, top: logoPosition.top + logoBounds.height / 2 },
            selected,
          });
        }
      });
    setLines(newLines);

    if (mouseOverSrc) {
      setForceSelectSource([mouseOverSrc]);
      setForceSelectDestination(connections.filter(c => c.from === mouseOverSrc).map(c => c.to));
    } else if (mouseOverDst) {
      setForceSelectDestination([mouseOverDst]);
      setForceSelectSource(connections.filter(c => c.to === mouseOverDst).map(c => c.from));
    } else {
      setForceSelectDestination([]);
      setForceSelectSource([]);
    }
  }, [connections, sources, destinations, windowSize, mouseOverSrc, mouseOverDst]);

  srcRefs.current = sources.map((_, i) => srcRefs.current[i] ?? React.createRef());
  dstRefs.current = destinations.map((_, i) => dstRefs.current[i] ?? React.createRef());

  return (
    <div className="w-full relative" ref={canvasRef}>
      <div className="flex flex-row" style={{ zIndex: 2 }}>
        <div className="flex flex-col grow">
          <Header {...p.srcActions} className="mb-4" />
          {sources.map((s, idx) => (
            <div
              key={s.id}
              ref={srcRefs.current[idx] as any}
              className="cursor-pointer mb-4"
              onClick={() => console.log("Clicked", s.id)}
              onMouseOver={() => {
                setMouseOverSrc(s.id);
              }}
              onMouseLeave={() => setMouseOverSrc(undefined)}
            >
              {s.card(forceSelectSource.includes(s.id))}
            </div>
          ))}
        </div>
        <div className="shrink px-36 flex items-center">
          <div className="flex flex-col items-center group">
            <Link
              className="block h-16 w-15 aspect-square  rounded-full hover:scale-110 transition-all duration-500 z-30"
              href={`/${workspaces.id}/connections`}
              ref={logoRef}
            >
              {branding.logo}
            </Link>
            <Link
              href={`/${workspaces.id}/connections`}
              className="flex items-center text-xs mt-2 opacity-0 group-hover:opacity-100 transition-all duration-500"
            >
              Connections <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        </div>
        <div className="flex flex-col grow">
          <Header {...p.dstActions} className="mb-4" />
          {destinations.map((dest, idx) => (
            <div
              className="cursor-pointer mb-4"
              key={dest.id}
              ref={dstRefs.current[idx] as any}
              onMouseOver={() => {
                setMouseOverDst(dest.id);
              }}
              onMouseLeave={() => setMouseOverDst(undefined)}
            >
              {dest.card(forceSelectDestination.includes(dest.id))}
            </div>
          ))}
        </div>
      </div>
      <svg className="w-full h-full absolute top-0 left-0" style={{ pointerEvents: "none" }}>
        {lines
          .sort((a, b) => {
            if (a.selected && !b.selected) {
              return 1;
            }
            if (!a.selected && b.selected) {
              return -1;
            }
            return 0;
          })
          .map((line, i) => {
            const lineCurves = `C${line.from.left + Math.abs(line.from.left - line.to.left) * 0.75},${line.from.top} ${
              line.to.left - Math.abs(line.from.left - line.to.left) * 0.75
            },${line.to.top} ${line.to.left},${line.to.top}`;

            const path = `M${line.from.left},${line.from.top} ${lineCurves}`;
            return (
              <path
                style={{ zIndex: line.selected ? 1 : 0 }}
                key={i}
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={line.selected ? 8 : 6}
                className={`${
                  line.selected ? "text-primaryDark" : "text-primaryLighter"
                } transition-colors duration-300`}
              />
            );
          })}
      </svg>
    </div>
  );
};
