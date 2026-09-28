"""Unit tests — payment attachment validation logic (no DB)."""
import pytest

from app.modules.payments.schemas import (
    ALLOWED_ATTACHMENT_CONTENT_TYPES,
    MAX_ATTACHMENT_SIZE_BYTES,
    validate_attachment,
)


class TestValidateAttachment:
    @pytest.mark.parametrize("content_type", sorted(ALLOWED_ATTACHMENT_CONTENT_TYPES))
    def test_allowed_types_pass(self, content_type):
        validate_attachment(content_type, 1024)  # should not raise

    def test_disallowed_type_rejected(self):
        with pytest.raises(ValueError, match="not allowed"):
            validate_attachment("application/zip", 1024)

    def test_empty_file_rejected(self):
        with pytest.raises(ValueError, match="Empty file"):
            validate_attachment("image/png", 0)

    def test_negative_size_rejected(self):
        with pytest.raises(ValueError, match="Empty file"):
            validate_attachment("image/png", -1)

    def test_exactly_at_limit_passes(self):
        validate_attachment("application/pdf", MAX_ATTACHMENT_SIZE_BYTES)

    def test_over_limit_rejected(self):
        with pytest.raises(ValueError, match="10 MB limit"):
            validate_attachment("application/pdf", MAX_ATTACHMENT_SIZE_BYTES + 1)
