export class RequiredEncounterBoundary extends Error {
  constructor(readonly minute: number) {
    super("people_required_encounter_boundary_use_wait");
  }
}
