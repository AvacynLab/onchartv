"use client";

import { useCallback, useMemo, type SetStateAction } from "react";
import useSWR from "swr";
import type { KeyedMutator } from "swr";
import type { UIArtifact } from "@/components/artifact";

export const initialArtifactData: UIArtifact = {
  documentId: "init",
  content: "",
  kind: "text",
  title: "",
  status: "idle",
  isVisible: false,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

type Selector<T> = (state: UIArtifact) => T;

export function useArtifactSelector<Selected>(selector: Selector<Selected>) {
  const { data: localArtifact } = useSWR<UIArtifact>("artifact", null, {
    fallbackData: initialArtifactData,
  });

  const selectedValue = useMemo(() => {
    if (!localArtifact) {
      return selector(initialArtifactData);
    }
    return selector(localArtifact);
  }, [localArtifact, selector]);

  return selectedValue;
}

export function useArtifact() {
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
    "artifact",
    null,
    {
      fallbackData: initialArtifactData,
    }
  );

  const artifact = useMemo(() => {
    if (!localArtifact) {
      return initialArtifactData;
    }
    return localArtifact;
  }, [localArtifact]);

  const setArtifact = useCallback(
    (updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)) => {
      setLocalArtifact((currentArtifact) => {
        const artifactToUpdate = currentArtifact || initialArtifactData;

        if (typeof updaterFn === "function") {
          return updaterFn(artifactToUpdate);
        }

        return updaterFn;
      });
    },
    [setLocalArtifact]
  );

  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } =
    useSWR<unknown | null>(
      () =>
        artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
      null,
      {
        fallbackData: null,
      }
    );

  /**
   * Normalises the SWR mutator so it mirrors React's `setState` contract. This
   * keeps artefact metadata setters fully typed without leaking SWR specifics
   * through the component tree.
   */
  const updateMetadata = useCallback(
    (value: SetStateAction<unknown | null>) => {
      if (typeof value === "function") {
        const updater = value as (current: unknown | null) => unknown | null;
        void (setLocalArtifactMetadata as KeyedMutator<unknown | null>)(
          (current: unknown | null) => updater(current ?? null),
          false
        );
        return;
      }

      void (setLocalArtifactMetadata as KeyedMutator<unknown | null>)(
        value ?? null,
        false
      );
    },
    [setLocalArtifactMetadata]
  );

  return useMemo(
    () => ({
      artifact,
      setArtifact,
      metadata: localArtifactMetadata,
      setMetadata: updateMetadata,
    }),
    [artifact, setArtifact, localArtifactMetadata, updateMetadata]
  );
}
