from studio.config import Settings


def test_binds_to_loopback_by_default(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(_env_file=None)
    assert settings.host == "127.0.0.1"
    assert settings.cutout_provider == "none"


def test_settings_come_from_prefixed_environment_variables(tmp_path, monkeypatch):
    monkeypatch.setenv("STUDIO_DATA_DIR", str(tmp_path / "elsewhere"))
    monkeypatch.setenv("STUDIO_CUTOUT_PROVIDER", "rembg")
    settings = Settings(_env_file=None)
    assert settings.media_dir == tmp_path / "elsewhere" / "media"
    assert settings.cutout_provider == "rembg"
