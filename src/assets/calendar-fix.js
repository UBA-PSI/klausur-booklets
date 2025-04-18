/**
 * Calendar Selection Fix
 * Fixes issues with calendar date selection and display
 */

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {

    // Reference to the MBZ Batch Creator instance (will be set later)
    let mbzCreatorInstance = null;

    /**
     * Sets the MBZ Batch Creator instance.
     * @param {MbzBatchCreator} instance - The MBZ Batch Creator instance.
     */
    function setMbzCreatorInstance(instance) {
        mbzCreatorInstance = instance;
        // Now that the instance is available, try to initialize the controller again
        // This is removed as initialization is now tied to buildUI in index.html
        // tryInitialize(); 
    }

    // Make setMbzCreatorInstance globally accessible
    window.setMbzCreatorInstance = setMbzCreatorInstance;

    // The rest of the file is removed as its functionality is merged into VerticalCalendarController.js
    // logger.log('Script loaded. DOM fully parsed.');
}); 