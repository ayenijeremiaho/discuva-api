import {
  BaptismRequest,
  ChildDedicationRequest,
  ChildNamingRequest,
  MarriageRequest,
} from '../dto/note-request.dto';
import {
  BaptismDetails,
  ChildDedicationDetails,
  ChildNamingDetails,
  MarriageDetails,
} from '../entity/note-details';

export type NoteRequest =
  | ChildNamingRequest
  | ChildDedicationRequest
  | MarriageRequest
  | BaptismRequest;

export type NoteDetails =
  | ChildNamingDetails
  | ChildDedicationDetails
  | MarriageDetails
  | BaptismDetails;

export type UpdateNoteRequest = Partial<NoteRequest>;
