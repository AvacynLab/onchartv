export function shouldDisableRemoteAvatars(): boolean {
  if (process.env.NEXT_PUBLIC_PLAYWRIGHT === "true") {
    return true;
  }

  if (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { webdriver?: boolean }).webdriver ===
      "boolean" &&
    (navigator as Navigator & { webdriver?: boolean }).webdriver
  ) {
    return true;
  }

  return false;
}
