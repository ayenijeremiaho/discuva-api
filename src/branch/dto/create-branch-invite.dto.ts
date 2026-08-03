import { IsBoolean, IsEmail, IsNotEmpty, IsOptional } from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

export class CreateBranchInviteDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Invalid email format' })
  @IsNotEmpty()
  email: string;

  // If true, the branch is provisioned onto the parent's current plan at no
  // independent cost when accepted — false means the normal independent
  // Free-tier signup. Has no effect if the parent is itself on Free (nothing
  // to sponsor onto), or by default (safest — no financial change to the
  // branch unless the parent explicitly opts in).
  @IsOptional()
  @IsBoolean()
  sponsorPlan?: boolean;
}
