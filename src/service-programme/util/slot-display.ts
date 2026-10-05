import { ServiceProgrammeSlot } from '../entity/service-programme-slot.entity';
import { ServiceSessionSlot } from '../entity/service-session-slot.entity';
import { ServiceSessionSlotStatusEnum } from '../enum/service-session-slot-status.enum';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';

export type ServiceProgrammeSlotWithNames = ServiceProgrammeSlot & {
  memberName?: string | null;
  backupMemberName?: string | null;
  departmentName?: string | null;
  backupDepartmentName?: string | null;
};

export interface EffectiveSessionSlot {
  id: string;
  position: number;
  status: ServiceSessionSlotStatusEnum;
  type: ServiceSlotTypeEnum;
  topic: string | null;
  allocatedMinutes: number;
  memberName: string | null;
  guestName: string | null;
  // Set when a whole department has the slot (and nobody has been put in its place on the day).
  departmentId: string | null;
  departmentName: string | null;
  backupMemberId: string | null;
  backupMemberName: string | null;
  backupGuestName: string | null;
  backupDepartmentName: string | null;
  actualSeconds: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

function fullName(
  member: { firstname: string; lastname: string } | null,
): string | null {
  return member ? `${member.firstname} ${member.lastname}` : null;
}

function resolveSpeaker(sessionSlot: ServiceSessionSlot): {
  memberName: string | null;
  guestName: string | null;
  departmentId: string | null;
  departmentName: string | null;
} {
  const none = { departmentId: null, departmentName: null };
  if (sessionSlot.overriddenMember) {
    return {
      memberName: fullName(sessionSlot.overriddenMember),
      guestName: null,
      ...none,
    };
  }
  if (sessionSlot.overriddenSpeakerName) {
    return {
      memberName: null,
      guestName: sessionSlot.overriddenSpeakerName,
      ...none,
    };
  }
  if (sessionSlot.programmeSlot.member) {
    return {
      memberName: fullName(sessionSlot.programmeSlot.member),
      guestName: null,
      ...none,
    };
  }
  const department = sessionSlot.programmeSlot.department;
  return {
    memberName: null,
    guestName: sessionSlot.programmeSlot.guestName,
    departmentId: department?.id ?? null,
    departmentName: department?.name ?? null,
  };
}

// Who is on the slot, for places that show a single name.
export function speakerLabel(slot: {
  memberName: string | null;
  guestName: string | null;
  departmentName: string | null;
}): string | null {
  return slot.memberName ?? slot.guestName ?? slot.departmentName;
}

export function toEffectiveSessionSlot(
  sessionSlot: ServiceSessionSlot,
): EffectiveSessionSlot {
  return {
    id: sessionSlot.id,
    position: sessionSlot.position,
    status: sessionSlot.status,
    type: sessionSlot.programmeSlot.type,
    topic: sessionSlot.overriddenTopic ?? sessionSlot.programmeSlot.topic,
    allocatedMinutes:
      sessionSlot.adjustedAllocatedMinutes ??
      sessionSlot.programmeSlot.allocatedMinutes,
    ...resolveSpeaker(sessionSlot),
    // The backup is fixed reference data from the DRAFT slot — there is no
    // "override the backup" concept, so it stays constant regardless of
    // whatever the primary speaker has been overridden to.
    backupMemberId: sessionSlot.programmeSlot.backupMember?.id ?? null,
    backupMemberName: fullName(sessionSlot.programmeSlot.backupMember),
    backupGuestName: sessionSlot.programmeSlot.backupGuestName,
    backupDepartmentName:
      sessionSlot.programmeSlot.backupDepartment?.name ?? null,
    actualSeconds: sessionSlot.actualSeconds,
    startedAt: sessionSlot.startedAt,
    completedAt: sessionSlot.completedAt,
  };
}

export function withEffectiveSessionSlots(
  sessionSlots: ServiceSessionSlot[],
): EffectiveSessionSlot[] {
  return [...sessionSlots]
    .sort((a, b) => a.position - b.position)
    .map(toEffectiveSessionSlot);
}

export function withMemberNames(
  slot: ServiceProgrammeSlot,
): ServiceProgrammeSlotWithNames {
  return {
    ...slot,
    memberName: fullName(slot.member),
    backupMemberName: fullName(slot.backupMember),
    departmentName: slot.department?.name ?? null,
    backupDepartmentName: slot.backupDepartment?.name ?? null,
  };
}

export function withMemberNamesList(
  slots: ServiceProgrammeSlot[],
): ServiceProgrammeSlotWithNames[] {
  return slots.map(withMemberNames);
}
