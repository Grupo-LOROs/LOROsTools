from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    cookie_domain: str = ".tu-dominio.com"
    cookie_secure: bool = True
    cors_allowed_origins: str = "https://portal.tu-dominio.com"
    files_root: str = "/data/files"

    class Config:
        env_prefix = ""
        case_sensitive = False

settings = Settings()
