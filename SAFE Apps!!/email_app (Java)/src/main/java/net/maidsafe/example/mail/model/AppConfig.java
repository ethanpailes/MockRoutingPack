package net.maidsafe.example.mail.model;

/**
 * The information needed by the application to bootstrap is stored in the config file
 */
public class AppConfig {

    // id field will have the email ID of the user
    private String id;
    // dataIdOfStructuredData corresponds to the SD which holds the list of Saved Messages
    private String structuredDataName;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getStructuredDataName() {
        return structuredDataName;
    }

    public void setStructuredDataName(String structuredDataName) {
        this.structuredDataName = structuredDataName;
    }
    
    
    
    
}
